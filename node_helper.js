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
	},

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
				function(){ self.getMailFeed(); }, 
				self.config.checkFreq
			);
			self.getMailFeed(); //call this now so we don't wait a whole cycle
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

	//Gets the contents of a gmail user's inbox with the currently held oauth tokens.
	getMailFeed: function(){
		console.log("getMailFeed");
		var self = this;
		//make an api call
		google.gmail('v1').users.messages.list({
			maxResults: this.config.maxResults,
			userId: 'me',
			auth:  this.getOAuth()
		}, function(error, result){ self.parseMailFeed(error, result); } );
	},
	
	//Parses the results of a mailbox contents request.
	parseMailFeed: function(error, result){
		console.log("parseMailFeed");
		//parse the results
		
		//if it succeeds:
		if(!error){
			//send the results to the frontend via notification
			this.sendSocketNotification("SHOW_MAIL_FEED", result.messages);

		//if it fails:
		}else{
			console.log(error);
			//if the tokens were invalid:
			if(this.config.tokens.refresh_token === "" || error.errors[0].reason === 'authError'){
				//stop the mail checker loop
				this.stopMailLoop();
				//tell the frontend to show the auth button
				this.sendSocketNotification("SHOW_AUTH_BUTTON");
			//else:
			}else{
				//retry?
			}
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

});

