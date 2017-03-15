# MMM-GmailNotifier
Unread mail notification for Gmail in the MagicMirror2 framework.

Requires the googleapis package, v18+

Installing:
  - checkout to your MM modules directory
  - npm install googleapis
  - create a new app for the google api:
    - nav to console.developers.google.com
    - create credentials -> OAuth Client ID
    - select Web Application
    - JS Origin: (http://)localhost:\<MM listen port, 8080 by default\>
    - Redirect: (http://)localhost:\<MM listen port, 8080 by default\>/MMM-GmailNotifier/redirect.html
  - edit your config.js:
    - clientId = "\<your app's client id\>", required
    - clientSecret = "\<your app's client secret\>", required
    - email = "\<your email address\>", required
    - maxResults = 1-10, number of unread messages to display
    - checkFreq = 60000-3600000, how often to check for unread messages, in milliseconds.
