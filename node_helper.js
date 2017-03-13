/* Magic Mirror
 * Module: MMM-Traffic
 *
 * By Sam Lewis https://github.com/SamLewis0602
 * MIT Licensed.
 */
 
var NodeHelper = require('node_helper');
var google = require('googleapis');
var fs = require('fs');
var OAuth2 = google.auth.OAuth2;

module.exports = NodeHelper.create({

	start: function () {
		console.log('MMM-GmailNotifier helper started ...');
		this.checkInProgress = false;
		this.messageIds = [];
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

	initMailFeed: function(cfg){
		console.log("initMailFeed");
		this.config = cfg;
		for(var i = 0; i < this.config.maxResults; i++){
			this.messageIds[i] = -1;
		}

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
				function(){ self.updateMessageList(); }, 
				self.config.checkFreq
			);
			self.updateMessageList(); //call this now so we don't wait a whole cycle
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

	//Stores any held oauth tokens to disk.
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

	//Generates and returns an oauth authorization url.
	getOAuthAuthUrl: function(){
		console.log("getOAuthAuthUrl");
		return this.getOAuth().generateAuthUrl({
			access_type: 'offline',
			scope: this.config.scopes,
			approval_prompt: 'force'
		});
	},

	updateMessageList: function(){
		this.getUnreadMessages();
	},

	//Gets ids of unread messages in a gmail inbox using the currently held oauth tokens.
	getUnreadMessages: function(){
		console.log("getUnreadMessages");
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
	
	//Parses the results of a mailbox contents request.
	parseUnreadMessageList: function(error, result){
		console.log("parseUnreadMessageList");

		//if something went wrong:
		if(error){
			console.log(error);
			//if the tokens were invalid:
			if(this.config.tokens.refresh_token === "" || error.errors[0].reason === 'authError'){
				//stop the mail checker loop
				this.stopMailLoop();
				//tell the frontend to show the auth button
				this.sendSocketNotification("SHOW_AUTH_BUTTON");

			//if some other error occurred:
			}else{
				//retry?
			}

		//if everything went ok:
		}else{
			console.log(result);

			//parse the list of messages
			//if the id we find doesn't match the one already in that slot, order an update.
			if(typeof result.messages === 'undefined'){
				console.log("got 0 message ids: " + ids);
				for(var i = 0; i < this.config.maxResults; i++){
					//no message here, clear this index.
					delete this.messageIds[i];
					this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i});
				}
			}else{
				console.log("got " + result.messages.length + " message ids");

				//read through the list, update any changed message ids
				for(var i = 0; i < this.config.maxResults; i++){

					if(typeof result.messages[i] === 'undefined' && typeof this.messageIds[i] !== 'undefined'){
						//no message, clear this slot.
						console.log("clearing message id " + i);
						delete this.messageIds[i];
						this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i});

					}else if(typeof result.messages[i] !== 'undefined'){
						console.log("message id " + i + ": " + result.messages[i].id);
						 if(this.messageIds[i] != result.messages[i].id){
							//message id is different, update this slot.
							console.log("id changed, getting contents");
							this.messageIds[i] = result.messages[i].id;						
							this.getMessageContents(i);
						}
					}
				}
			}
		}
		
	},

	getMessageContents: function(index){
		console.log("getMessageContents");

		var self = this;
		//make a n api call
		google.gmail('v1').users.messages.get({
			auth:  this.getOAuth(),
			userId: this.config.email,
			id: this.messageIds[index],
			format: "metadata",
			metadataHeaders: ["Subject","From","Date"],
			
		}, function(error, result){ self.parseMessageContents(error, result, index); } );
	},

	parseMessageContents: function(error, result, i){
		//if something went wrong:
		if(error){
			console.log(error);
			//if the tokens were invalid:
			if(this.config.tokens.refresh_token === "" || error.errors[0].reason === 'authError'){
				//stop the mail checker loop
				this.stopMailLoop();
				//tell the frontend to show the auth button
				this.sendSocketNotification("SHOW_AUTH_BUTTON");

			//if some other error occurred:
			}else{
				this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, headers: {subject: "Error Retrieving Message."}});
			}

		//if everything went ok:
		}else{
			console.log(result);
			this.sendSocketNotification("UPDATE_MESSAGE_ROW", {index: i, headers: {subject: this.getHeaderParam(result, "Subject"), sender: this.getHeaderParam(result, "From"), date: this.getHeaderParam(result, "Date")}});
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

