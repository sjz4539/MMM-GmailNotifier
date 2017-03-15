/* 
 * Based on MMM-Traffic by Sam Lewis https://github.com/SamLewis0602
 */
 
var NodeHelper = require('node_helper');
var moment = require('moment');
var google = require('googleapis');
var fs = require('fs');
var OAuth2 = google.auth.OAuth2;

module.exports = NodeHelper.create({

	start: function () {
		console.log('MMM-GmailNotifier helper started ...');

		this.messageIds = []; //map of view slots to message ids, tracks which messages are shown where.
		this.messageData = []; //map of message ids to contents, saves on api calls.

		this.DEBUG = true; //If true, print debug output to console.
	},

	socketNotificationReceived: function(notification, payload) {

		this.printDebug("GmailNotifier node_helper received notification " + notification + " with payload " + payload);

		if(notification === "INIT_MAIL_FEED"){
			this.initMailFeed(payload);

		}else if(notification === "PROCESS_AUTH_CODE"){
			this.processAuthCode(payload);

		}else if(notification === "GEN_AUTH_URL"){
			this.sendSocketNotification("SHOW_AUTH_WINDOW", this.getOAuthAuthUrl());

		}else if(notification === "PRINT_MESSAGE"){
			this.printDebug(payload);

		}
	},

	/**
	 * Called to set the config options for this helper and start the mail checker.
	 *
	 * @param cfg Object The config parameters for this node helper. Should be
	 * this.config from the base module instance.
	 */
	initMailFeed: function(cfg){
		this.printDebug("initMailFeed");
		this.config = cfg;

		//load up our saved tokens if they exist
		this.loadTokens(this.config.tokenPath);
		//init client object
		this.getOAuth().setCredentials(this.config.tokens);
		//start the mail loop
		this.startMailLoop();
	},

	/**
	 * Starts the mail checker.
	 */
	startMailLoop: function(){
		this.printDebug("startMailLoop");
		if(!this.tokensLoaded()){
			this.sendSocketNotification("SHOW_AUTH_BUTTON");
		}else if(typeof this.mailLoop === 'undefined'){
			var self = this;
			this.mailLoop = setInterval(
				function(){ self.getUnreadMessageList(); }, 
				self.config.checkFreq
			);
			this.getUnreadMessageList(); //call this now so we don't wait a whole cycle
		}
	},

	/**
	 * Stops the mail checker.
	 */
	stopMailLoop: function(){
		this.printDebug("stopMailFeed");
		if(typeof this.mailLoop !== 'undefined'){
			clearInterval(this.mailLoop);
			delete this.mailLoop;
		}
	},

	/**
	 * Loads any saved oauth tokens from disk.
	 */
	loadTokens: function(){
		this.printDebug("loadTokens");
		try{
			var tokenFile = fs.readFileSync(this.config.tokenPath, {encoding: "utf8"});
			this.config.tokens = JSON.parse(tokenFile);
			this.printDebug("loaded tokens: ");
			this.printDebug(this.config.tokens);
		}catch(e){
			this.printDebug("Error loading tokens or no saved tokens found.");
			this.printDebug(e);
			this.clearTokens();
		}
	},		

	/**
	 * Writes any held oauth tokens to disk.
	 */
	saveTokens: function(){
		this.printDebug("saveTokens");
		try {
			fs.mkdirSync(this.config.tokenDir);
		} catch (err) {
			if (err.code != 'EEXIST') {
				throw err;
			}
		}
		fs.writeFileSync(this.config.tokenPath, JSON.stringify(this.config.tokens));
		this.printDebug('Token stored to ' + this.config.tokenPath);
	},

	/*
	 * @return True if either an access token or refresh token exists and has
	 * a length greater than zero.
	 */
	tokensLoaded: function(){
		return (
			typeof this.config.tokens !== 'undefined' &&
			(
				typeof this.config.tokens.access_token !== 'undefined' &&
				this.config.tokens.access_token.length > 0
			) || (
				typeof this.config.tokens.refresh_token !== 'undefined' &&
				this.config.tokens.refresh_token.length > 0
			)
		);
	},

	/*
	 * Resets the access and refresh tokens to empty strings.
	 */
	clearTokens: function(){
		this.config.tokens = {
			access_token: "",
			refresh_token: ""
		}
	},

	/**
	 * Creates/retrieves a singleton oauth client object.
	 */
	getOAuth: function(){
		this.printDebug("getOAuth");
		if(typeof this.oauth2Client === 'undefined'){
			this.printDebug("generated new oauth client");
			this.oauth2Client  = new OAuth2(this.config.clientId, this.config.clientSecret, this.config.redirectURL);
		}
		return this.oauth2Client;
	},

	/**
	 * Generates and returns an oauth authorization request url.
	 */
	getOAuthAuthUrl: function(){
		this.printDebug("getOAuthAuthUrl");
		return this.getOAuth().generateAuthUrl({
			access_type: 'offline',
			scope: this.config.scopes,
			approval_prompt: 'force'
		});
	},

	/**
	 * Gets ids of unread messages in a gmail inbox using the currently held oauth tokens.
	 */
	getUnreadMessageList: function(){
		this.printDebug("getUnreadMessageList");
		var self = this;
		//make an api call
		google.gmail('v1').users.messages.list({
			auth:  this.getOAuth(),
			userId: this.config.email,
			maxResults: this.config.maxResults,
			labelIds: "INBOX",
			q: "is:unread",
		}, function(error, result){ self.parseUnreadMessageList(error, result); } );
	},

	/**
	 * Parses the results of a mailbox contents request. Updates the list of message ids
	 * currently being displayed, then clears the message data cache of any useless information.
	 * If any message id slot contents are changed, the view will be updated as needed.
	 *
	 * @param error mixed Information about some error that occurred, if any.
	 * @param result mixed The results of an api call sent out by getUnreadMessageList, expects JSON object.
	 */
	parseUnreadMessageList: function(error, result){
		this.printDebug("parseUnreadMessageList");

		//if something went wrong:
		if(error){
			this.printDebug(error);

			//if the tokens were invalid:
			if( (!this.tokensLoaded()) || this.authError(error) ){
				//stop the mail checker loop
				this.stopMailLoop();
				//tell the frontend to show the auth button
				this.sendSocketNotification("SHOW_AUTH_BUTTON");

			//did some internal error occur (like a timeout)?
			}else if(typeof error.errors === 'undefined'){
				return false; //bail out here, this update failed. We'll retry later.

			}

		//if everything went ok:
		}else{
			this.printDebug(result);

			//parse the list of messages and call updateMessageSlot for each.

			if(typeof result.messages === 'undefined'){
				//we got 0 results back, clear all rows.
				this.printDebug("got 0 message ids");
				for(var i = 0; i < this.config.maxResults; i++){
					delete this.messageIds[i];
					this.updateMessageSlot(i);
				}

			}else{
				this.printDebug("got " + result.messages.length + " message ids");

				//read through the list, update any changed message ids
				for(var i = 0; i < this.config.maxResults; i++){
					
					if(typeof result.messages[i] === 'undefined' && typeof this.messageIds[i] !== 'undefined'){
						//no message, clear this slot.
						this.printDebug("Message slot " + i + " now empty");
						delete this.messageIds[i];
						this.updateMessageSlot(i);
					}else if(typeof result.messages[i] !== 'undefined' && this.messageIds[i] != result.messages[i].id){
						//message id changed, update it.
						this.printDebug("Message slot " + i + " is now " + result.messages[i].id);
						this.messageIds[i] = result.messages[i].id;
						this.updateMessageSlot(i);
					}
				}
				
				//remove any useless message data from the cache
				//any keys that aren't in our new message id list should be dropped
				//just copy over anything we still need to a new array and replace the old one.
				//gc should take care of it.
				var newData = [];
				for(var i = 0; i < this.messageIds.length; i++){
					if(typeof this.messageData[this.messageIds[i]] !== 'undefined'){
						newData[this.messageIds[i]] = this.messageData[this.messageIds[i]];
					}
				}
				this.messageData = newData;
			}
		}
	},

	/**
	 * Starts the process of updating the view to reflect a message ID slot. Spawns an API
	 * call if data corresponding to that message ID is not currently cached.
	 *
	 * @param i int The index of the message view slot that should be updated.
	 */
	updateMessageSlot: function(i){
		this.printDebug("updateMessageSlot");

		if(typeof this.messageIds[i] === 'undefined'){
			this.printDebug("slot " + i + " empty");
			//this message slot is now blank, tell the view.
			this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i});

		}else{
			var messageId = this.messageIds[i];
			this.printDebug("slot " + i + " contains message id " + messageId);

			if(typeof this.messageData[messageId] !== 'undefined'){			
				//we already have data for this messageId, reuse it.
				this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, data: this.messageData[messageId]});

			}else{
				//have to get new data, make an API call.
				this.printDebug("retriving new message data for id " + messageId);
				var self = this;
				//make an api call
				google.gmail('v1').users.messages.get({
					auth:  this.getOAuth(),
					userId: this.config.email,
					id: messageId,
					format: "metadata",
					metadataHeaders: ["Subject","From","Date"],
		
				}, function(error, result){ self.parseMessageData(error, result, i); } );
			}
		}
	},

	/**
	 * Parses the json object returned by a message.get call to the gmail api,
	 * stores it in the cache, and signals the view to update.
	 *
	 * @param error mixed Information about some error that occurred, if any.
	 * @param result mixed Result data from a gmail api call, expects JSON object.
	 * @param i int The index of the message ID slot that this data was requested for.
	 */
	parseMessageData: function(error, result, i){
		this.printDebug("parseMessageData");
		//if something went wrong:
		if(error){
			this.printDebug(error);

			//if the tokens were invalid:
			if( (!this.tokensLoaded()) || this.authError(error) ){
				//stop the mail checker loop
				this.stopMailLoop();
				//tell the frontend to show the auth button
				this.sendSocketNotification("SHOW_AUTH_BUTTON");

			//did some internal error occur (like a timeout)?
			}else if(typeof error.errors === 'undefined'){
				this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, data: {subject: "Error Retrieving Message."}});

			//if some other error occurred:
			}else{
				this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, data: {subject: "Error Retrieving Message."}});
			}

		//if everything went ok:
		}else{
			this.printDebug(result);

			var d = {};
				
			d.subject = this.getHeaderParam(result, "Subject");
			
			var sender = this.getHeaderParam(result, "From"); 
			var a = sender.indexOf("<");
			var b = sender.indexOf(">");
			if(a != -1){
				d.senderName = sender.substring(0, a - 1);
				if(b != -1){
					d.senderAddress = sender.substring(a + 1, b);
				}
			}

			var date = this.getHeaderParam(result, "Date");
			if(date !== ""){
				var m = moment(new Date(date));
				d.date = m.format("M/D");
				d.time = m.format("h:mma");
			}
			
			this.printDebug(d);
			
			this.messageData[this.messageIds[i]] = d;
			this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, data: d});
		}
	},

	/**
	 * Converts an authorization code URL and retrives OAuth tokens with it.
	 * 
	 * @param url A redirect URL returned by the google oauth process 
	 * containing an authorization code parameter.
	 */
	processAuthCode: function(url){
		this.printDebug("processAuthCode");

		var code = this.getUrlParam(url, "code");
		this.printDebug("got auth code: " + code);

		if(code != ""){
			var tokens = {};
			var self = this;
			this.getOAuth().getToken(code, function (err, tokens) {	
				// Now tokens contains an access_token and an optional refresh_token. Save them.
				if (!err) {
					this.printDebug("received tokens");
					this.printDebug("access_token = " + tokens.access_token);
					this.printDebug("refresh_token = " + tokens.refresh_token);
					self.config.tokens = tokens;
					self.getOAuth().setCredentials(self.config.tokens);
					self.saveTokens();
					self.startMailLoop();
				}
			});
		}
	},

	/**
	 * @param url A url
	 * @param name The name of a query string parameter
	 * @return The value of the specified parameter as a string if found within the url, empty string otherwise.
	 */
	getUrlParam: function(url, name) {
            name = name.replace(/[[]/,"\[").replace(/[]]/,"\]");
            var regexS = "[\?&]"+name+"=([^&#]*)";
            var regex = new RegExp( regexS );
            var results = regex.exec( url );
            if( results == null )
                return "";
            else
                return results[1];
        },

	/**
	 * @param json array A JSON unordered list of key-value pairs
	 * @param id String The key value to search for
	 * @return The value associated with the specified id if found, empty string otherwise.
	 */
	getHeaderParam: function(json, id){
		var result = "";
		try{
			for(index in json.payload.headers){
				this.printDebug(json.payload.headers[index].name + " " + json.payload.headers[index].value);
				if(json.payload.headers[index].name == id){
					result = json.payload.headers[index].value;
				}
			}
		}catch(e){}

		return result;
	},

	authError: function(error){
		return error && error.errors && error.errors[0] && error.errors[0].reason === 'authError'
	},

	printDebug: function(message){
		if(this.DEBUG){
			console.log(message);
		}
	},
});

