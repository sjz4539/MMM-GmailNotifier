/*

MMM-GmailNotifier
A MagicMirror2 unread email notifier using the gmail api and oauth

Requires the googleapis package, v18+

config.js values:
	maxResults: Number of unread emails to display. Integer between 1 & 10, default 5.
	checkFreq: How often to poll for unread email, in milliseconds. Integer between 60000 (one minute) and 3600000 (one hour).
	fade: If true, fade effect is used on lower end of display. Default true.
	clientId: Client Id of google api app. Create your own.
	clientSecret: Client Secret from the same ^.
	email: Your email address.
*/

Module.register("MMM-GmailNotifier", {

	//default config values
	defaults: {
		maxResults: 5,
		checkFreq: 60000,
		fade: true,
		email: "me",
		clientId: "",
		clientSecret: "",
	},

	// ===========================
	// STANDARD MODULE FUNCTIONS
	// ===========================
	
	start: function(){
		//Log.info('MMM-GmailNotifier Started...');
		this.config.redirectURL = "http://localhost:8080/MMM-GmailNotifier/redirect.html",
		this.config.scopes = [
			'https://www.googleapis.com/auth/gmail.readonly'
		]
		this.config.tokenDir = this.data.path + 'oauth/';
		this.config.tokenPath = this.data.path + 'oauth/gmail-oauth.json';

		if(this.config.maxResults > 10){
			this.config.maxResults = 10;
		}

		this.state = 0;
		this.messageRows = [];

		for(var i = 0; i < this.config.maxResults; i++){
			this.messageRows[i] = this.genMessageRow();
		}

		//Log.info("this.messageRows: " + this.messageRows);	
		this.sendSocketNotification("INIT_MAIL_FEED", this.config);
	},

	socketNotificationReceived: function(notification, payload) {

		//Log.info("GmailNotifier received notification " + notification);

		if(notification === "SHOW_LOADING_MESSAGE"){
			this.showLoadingMessage();

		}else if(notification === "SHOW_AUTH_BUTTON"){
			this.showAuthButton();

		}else if(notification === "SHOW_MAIL_FEED"){
			this.showMailFeed();

		}else if(notification === "SHOW_AUTH_WINDOW"){
			this.showAuthWindow(payload);

		}else if(notification === "UPDATE_MESSAGE_ROW"){
			this.updateMessageRow(payload.index, payload.data);
			this.showMailFeed();

		}
	},

	getScripts: function(){
		return [];
	},

	getStyles: function(){
		return [];
	},

	getDom: function(){
		var container = document.createElement('table');
		container.className = "small";


		if(this.config.clientId === "" || this.config.clientSecret === ""){
			//invalid config
			container.innerHTML = "Client ID/Secret missing. Check your config.";
			container.className = "small dimmed";

		}else if(this.state == 0){
			//not yet loaded up
			container.innerHTML = "Loading...";
			container.className = "small dimmed";

		}else if(this.state == 1){
			//require user auth
			var messageRow = document.createElement("tr");
			messageRow.innerHTML = "Authorization Required.";
			container.appendChild(messageRow);

			var loginRow = document.createElement("tr");
			var loginButton = document.createElement("input");
			loginButton.setAttribute("type", "button");
			loginButton.value = "Authorize";

			var self = this;
			loginButton.onclick = function(event){
				self.sendSocketNotification("GEN_AUTH_URL");
			};
			
			loginRow.appendChild(loginButton);
			container.appendChild(loginRow);

		}else if(this.state == 2){
			//got messages
			for(var i = 0; i < this.messageRows.length; i++){
				container.appendChild(this.messageRows[i]);
			}
		}

		return container;
	},

	genMessageRow: function(){
		var messageRow = document.createElement("tr");
		var rowTable = document.createElement("table");
		var subjectRow = document.createElement("tr");
		var infoRow = document.createElement("tr");

		messageRow.subjectCell = document.createElement("td");
		messageRow.infoCell = document.createElement("td");

		subjectRow.appendChild(messageRow.subjectCell);
		subjectRow.className="small";
		infoRow.appendChild(messageRow.infoCell);
		infoRow.className="dimmed xsmall";

		rowTable.appendChild(subjectRow);
		rowTable.appendChild(infoRow);
		messageRow.appendChild(rowTable);

		messageRow.className = "messagerow";

		return messageRow;
	},

	// ===================
	// VIEW STATE FUNCTIONS
	// ===================

	showLoadingMessage: function(){
		if(this.state != 0){
			this.state = 0;
			this.updateDom();
		}
	},

	showAuthButton: function(){
		if(this.state != 1){
			this.state = 1;
			this.updateDom();
		}
	},

	showMailFeed: function(){
		if(this.state != 2){
			this.state = 2;
			this.updateDom();
		}
	},
	
	showAuthWindow: function(url){
		//create a new window, redirect to a generated auth url
		//get a new refresh/access token pair
		var self = this;
		this.authWin = window.open(url, "windowname1", 'width=800, height=600');

		var pollTimer = setInterval( function(){ 
			try{
				//this.sendSocketNotification("PRINT_MESSAGE", "current URL is " + this.authWin.document.URL);
				if(self.authWin.location.indexOf(self.config.redirectURL) != -1){
					var retUrl = self.authWin.location;
					clearInterval(pollTimer);
					self.authWin.close();
					delete self.authWin;
					self.sendSocketNotification("PROCESS_AUTH_CODE", retUrl);
				}
			}catch(e){
				Log.info(e);
			}
		}, 100);
		
	},

	clearMessageRows: function(){
		for(row in this.messageRows){
			this.messageRows[row].subjectCell.innerHTML = "";
			this.messageRows[row].infoCell.innerHTML = "";
		}
	},

	updateMessageRow: function(index, data){
		//Log.info("updateMessageRow " + index);
		var messageRow = this.messageRows[index];

		if(typeof data === 'undefined'){
			if(index == 0){
				messageRow.subjectCell.innerHTML = "No unread messages.";
			}else{
				messageRow.subjectCell.innerHTML = "";
			}
			messageRow.infoCell.innerHTML = "";

		}else{
			messageRow.subjectCell.innerHTML = data.subject || "Some Message";
			messageRow.infoCell.innerHTML = "From " + (data.senderName || "someone") + " (" + (data.senderAddress || "somewhere") + ") at " + (data.time || "some time") + " on " + (data.date || "some day");

		}
	}

});
