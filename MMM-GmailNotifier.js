//basic flow:
//	startup
//	init client
//	get oauth refresh token
//	validate oauth refresh token
//	get oauth access token
//	start loop: every x minutes:
//		call gmail api
//		update view with information

//if any step fails, jump back to earlier steps
//EX: if access token is bad, blank it and then call the function to get a new one,
//which should check if the access is token is blank and use the refresh token to get a new one before returning it

//if access and refresh tokens are invalid, 
//display a message and login button for the user

//on startup:
// view defaults to loading message
// controller initializes

//controller commands view to swap between displays

Module.register("MMM-GmailNotifier", {

	//default config values
	defaults: {
		maxResults: 5,
		checkFreq: 60000,
		clientId: "",
		clientSecret: "",
	},

	// ===========================
	// STANDARD MODULE FUNCTIONS
	// ===========================
	
	start: function(){
		Log.info('MMM-GmailNotifier Started...');
		this.config.redirectURL = "http://localhost:8080/MMM-GmailNotifier/redirect.html",
		this.config.scopes = [
			'https://www.googleapis.com/auth/gmail.readonly'
		]
		this.config.tokenDir = this.data.path + 'oauth/';
		this.config.tokenPath = this.data.path + 'oauth/gmail-oauth.json';
		this.state = 0;
		this.sendSocketNotification("INIT_MAIL_FEED", this.config);
	},

	socketNotificationReceived: function(notification, payload) {

		Log.info("GmailNotifier received notification " + notification);

		if(notification === "SHOW_LOADING_MESSAGE"){
			this.showLoadingMessage();

		}else if(notification === "SHOW_AUTH_BUTTON"){
			this.showAuthButton();

		}else if(notification === "SHOW_MAIL_FEED"){
			this.showMailFeed(payload);

		}else if(notification === "SHOW_AUTH_WINDOW"){
			this.showAuthWindow(payload);

		}
	},

	getScripts: function(){
		return [];
	},

	getStyles: function(){
		return [];
	},

	getDom: function(){
		var container = document.createElement('div');

		if(this.config.clientId === "" || this.config.clientSecret === ""){
			container.innerHTML = this.translate("Client ID/Secret missing. Check your config.");

		}else if(this.state == 0){
			container.id = "loading-div";
			container.innerHTML = "Loading...";

		}else if(this.state == 1){
			container.id = "authorize-div";

			//display a simple message to the user
			var loginMessage = document.createElement("span");
			loginMessage.innerHTML = "Grant access to your Gmail account";
			container.appendChild(loginMessage);

			//display login button
			var loginButton = document.createElement("input");
			loginButton.setAttribute("type", "button");
			loginButton.innerHTML = "Authorize";
			loginButton.id = "authorize-button";

			var self = this;

			loginButton.onclick = function(event){
				self.sendSocketNotification("GEN_AUTH_URL");
			};
			container.appendChild(loginButton);

		}else if(this.state == 2){
			container.id = "mail-div";
			//could fill this here using some defined variable
			//could also let the helper call a function that does this later via notification
			container.innerHTML = "Got Emails";
		}

		return container;
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

	showMailFeed: function(mail){
		this.state = 2;
		this.mail = mail;
		this.updateDom();
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

});
