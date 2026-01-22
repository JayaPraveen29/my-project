// src/firebase.js
// Import the functions you need from the SDKs
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCKQTvmCNGjm8LnUg9t1gRNU0kzIStYLuY",
  authDomain: "myapp-a6e0d.firebaseapp.com",
  projectId: "myapp-a6e0d",
  storageBucket: "myapp-a6e0d.appspot.com",
  messagingSenderId: "253316574788",
  appId: "1:253316574788:web:519e1f368ac1eb098e9611",
  measurementId: "G-CRVVB4SL3Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
