// Copy this file to `firebase-config.js` and fill in your Firebase
// project's web config to enable cloud sync + the club system.
// Find it in: Firebase console -> Project settings -> Your apps -> Web app.
//
// IMPORTANT: a Firebase web apiKey is PUBLIC BY DESIGN — it ships in
// every browser. Your data is protected by Firestore Security Rules
// (see firestore.rules) + Auth authorized domains, NOT by hiding this
// key. `firebase-config.js` is gitignored only to keep it out of source
// control and silence secret scanners; it is not a true secret.
//
// Leave the placeholder below as-is to run the app in single-user mode
// (localStorage + Google Drive sync only, no cloud club / multi-coach).
window.__FIREBASE_CONFIG__ = {
  apiKey:            "REPLACE_ME_AFTER_FIREBASE_SETUP",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId:             "REPLACE_ME",
};
