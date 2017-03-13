/* Magic Mirror
 * Module: MMM-Traffic
 *
 * By Sam Lewis https://github.com/SamLewis0602
 * MIT Licensed.
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
	},

	socketNotificationReceived: function(notification, payload) {

		console.log("GmailNotifier node_helper received notification " + notification + " with payload " + payload);

		if(notification === "INIT_MAIL_FEED"){
			this.initMailFeed(payload);

		}else if(notification === "PROCESS_AUTH_CODE"){
			this.processAuthCode(payload);

		}else if(notification === "GEN_AUTH_URL"){
			this.sendSocketNotification("SHOW_AUTH_WINDOW", this.getOAuthAuthUrl());

		}else if(notification === "PRINT_MESSAGE"){
			console.log(payload);

		}
	},

	//called to set the config options for this helper and start the mail checker.
	initMailFeed: function(cfg){
		console.log("initMailFeed");
		this.config = cfg;

		//load up our saved tokens if they exist
		this.loadTokens(this.config.tokenPath);
		//init client object
		this.getOAuth().setCredentials(this.config.tokens);
		//start the mail loop
		this.startMailLoop();
	},

	//Starts the mail checker loop if it isn't already running.
	startMailLoop: function(){
		console.log("startMailLoop");
		if(typeof this.mailLoop === 'undefined'){
			var self = this;
			this.mailLoop = setInterval(
				function(){ self.getUnreadMessageList(); }, 
				self.config.checkFreq
			);
			self.getUnreadMessageList(); //call this now so we don't wait a whole cycle
		}
	},

	//Stops the mail checker loop if it's currently running.
	stopMailLoop: function(){
		console.log("stopMailFeed");
		if(typeof this.mailLoop !== 'undefined'){
			clearInterval(this.mailLoop);
			delete this.mailLoop;
		}
	},

	//Loads any saved oauth tokens from disk.
	loadTokens: function(){
		console.log("loadTokens");
		try{
			var tokenFile = fs.readFileSync(this.config.tokenPath, {encoding: "utf8"});
			this.config.tokens = JSON.parse(tokenFile);
			console.log("loaded tokens: ");
			console.log(this.config.tokens);
		}catch(e){
			console.log("Error loading tokens or no saved tokens found.");
			console.log(e);
			this.config.tokens = {
				access_token: "",
				refresh_token: ""
			};
		}
	},

	//Writes any held oauth tokens to disk.
	saveTokens: function(){
		console.log("saveTokens");
		try {
			fs.mkdirSync(this.config.tokenDir);
		} catch (err) {
			if (err.code != 'EEXIST') {
				throw err;
			}
		}
		fs.writeFileSync(this.config.tokenPath, JSON.stringify(this.config.tokens));
		console.log('Token stored to ' + this.config.tokenPath);
	},

	//Creates/retrieves a singleton oauth client object.
	getOAuth: function(){
		console.log("getOAuth");
		if(typeof this.oauth2Client === 'undefined'){
			console.log("generated new oauth client");
			this.oauth2Client  = new OAuth2(this.config.clientId, this.config.clientSecret, this.config.redirectURL);
		}
		return this.oauth2Client;
	},

	//Generates and returns an oauth authorization request url.
	getOAuthAuthUrl: function(){
		console.log("getOAuthAuthUrl");
		return this.getOAuth().generateAuthUrl({
			access_type: 'offline',
			scope: this.config.scopes,
			approval_prompt: 'force'
		});
	},

	//Gets ids of unread messages in a gmail inbox using the currently held oauth tokens.
	getUnreadMessageList: function(){
		console.log("getUnreadMessageList");
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
	
	//Parses the results of a mailbox contents request. Updates the list of message ids
	//currently being displayed, then clears the message data cache of any useless information.
	parseUnreadMessageList: function(error, result){
		console.log("parseUnreadMessageList");

		//if something went wrong:
		if(error){
			console.log(error);

			//did some internal error occur (like a timeout)?
			if(typeof error.errors === 'undefined'){
				return false; //bail out here, this update failed. We'll retry later.

			//if the tokens were invalid:
			}else if(this.config.tokens.refresh_token === "" || error.errors[0].reason === 'authError'){
				//stop the mail checker loop
				this.stopMailLoop();
				//tell the frontend to show the auth button
				this.sendSocketNotification("SHOW_AUTH_BUTTON");

			}

		//if everything went ok:
		}else{
			console.log(result);

			//parse the list of messages and call updateMessageSlot for each.

			if(typeof result.messages === 'undefined'){
				//we got 0 results back, clear all rows.
				console.log("got 0 message ids");
				for(var i = 0; i < this.config.maxResults; i++){
					delete this.messageData[i];
					this.updateMessageSlot(i);
				}

			}else{
				console.log("got " + result.messages.length + " message ids");

				//read through the list, update any changed message ids
				for(var i = 0; i < this.config.maxResults; i++){
					
					if(typeof result.messages[i] === 'undefined' && typeof this.messageIds[i] !== 'undefined'){
						//no message, clear this slot.
						console.log("Message slot " + i + " now empty");
						delete this.messageIds[i];
						this.updateMessageSlot(i);
					}else if(typeof result.messages[i] !== 'undefined' && this.messageIds[i] != result.messages[i].id){
						//message id changed, update it.
						console.log("Message slot " + i + " is now " + result.messages[i].id);
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

	//signals the view to update slot i if the necessary data is cached, otherwise this
	//sends a message.get call to the gmail api to retrieve it.
	updateMessageSlot: function(i){
		console.log("updateMessageSlot");

		if(typeof this.messageIds[i] === 'undefined'){
			console.log("slot " + i + " empty");
			//this message slot is now blank, tell the view.
			this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i});

		}else{
			var messageId = this.messageIds[i];
			
			if(typeof this.messageData[messageId] !== 'undefined'){			
				//we already have data for this messageId, reuse it.
				this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, data: this.messageData[messageId]});

			}else{
				//have to get new data, make an API call.
				console.log("retriving new message data for id " + messageId);
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

	//parses the json object returned by a message.get call to the gmail api,
	//stores it in the cache, and signals the view to update.
	parseMessageData: function(error, result, i){
		console.log("parseMessageData");
		//if something went wrong:
		if(error){
			console.log(error);

			//did some internal error occur (like a timeout)?
			if(typeof error.errors === 'undefined'){
				this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, data: {subject: "Error Retrieving Message."}});

			//if the tokens were invalid:
			}else if(this.config.tokens.refresh_token === "" || error.errors[0].reason === 'authError'){
				//stop the mail checker loop
				this.stopMailLoop();
				//tell the frontend to show the auth button
				this.sendSocketNotification("SHOW_AUTH_BUTTON");

			//if some other error occurred:
			}else{
				this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, data: {subject: "Error Retrieving Message."}});
			}

		//if everything went ok:
		}else{
			console.log(result);

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
			
			console.log(d);
			
			this.messageData[this.messageIds[i]] = d;
			this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, data: d});
		}
	},

	processAuthCode: function(url){
		console.log("processAuthCode");

		var code = this.getUrlParam(url, "code");
		console.log("got auth code: " + code);

		if(code != ""){
			var tokens = {};
			var self = this;
			this.getOAuth().getToken(code, function (err, tokens) {	
				// Now tokens contains an access_token and an optional refresh_token. Save them.
				if (!err) {
					console.log("received tokens");
					console.log("access_token = " + tokens.access_token);
					console.log("refresh_token = " + tokens.refresh_token);
					self.config.tokens = tokens;
					self.getOAuth().setCredentials(self.config.tokens);
					self.saveTokens();
					self.startMailLoop();
				}
			});
		}
	},

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

	getHeaderParam: function(json, id){
		var result = "";
		try{
			for(index in json.payload.headers){
				console.log(json.payload.headers[index].name + " " + json.payload.headers[index].value);
				if(json.payload.headers[index].name == id){
					result = json.payload.headers[index].value;
				}
			}
		}catch(e){}

		return result;
	}

});

