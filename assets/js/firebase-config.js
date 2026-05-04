// Firebase Configuration (Shared with UrlaubsplanerV2)
const firebaseConfig = {
  apiKey: "AIzaSyAopuMnqYLzaG3ZOK5CurDLvZHU26beqjk",
  authDomain: "rotationstool-stefan.firebaseapp.com",
  projectId: "rotationstool-stefan",
  storageBucket: "rotationstool-stefan.firebasestorage.app",
  messagingSenderId: "1068602704394",
  appId: "1:1068602704394:web:47acb001136b65654bd5f3"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const firebaseAuth = firebase.auth();
