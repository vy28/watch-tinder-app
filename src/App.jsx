import React, { useState, useEffect } from 'react';
import {
  ThumbsUp,
  ThumbsDown,
  User,
  Search,
  Trash2,
  HelpCircle,
  Heart,
  X,
  EyeOff,
  HeartOff,
  CirclePlus
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  setDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';

// ------------------
// Firebase Config
// ------------------
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const WatchApp = () => {
  const [user, setUser] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingData, setOnboardingData] = useState({
    wristSize: '',
    ownedWatches: [],
  });
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('signup');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });

  // Watches loaded from Firestore
  const [watches, setWatches] = useState([]);
  const [currentWatch, setCurrentWatch] = useState(0);

  // Liked (saved) watches
  const [likedWatches, setLikedWatches] = useState([]);

  // Searching in Onboarding for owned watches
  const [searchTerm, setSearchTerm] = useState('');

  // We'll store the *search results* from Firestore-based watches
  const [searchResults, setSearchResults] = useState([]); // NEW

  // Profile & Saved modals
  const [showProfile, setShowProfile] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  // User doc data from Firestore
  const [userData, setUserData] = useState(null);

  // -------------------------
  // 1) Fetch All Watches
  // -------------------------
  const fetchAllWatches = async () => {
    try {
      const q = query(collection(db, 'watches'));
      const querySnapshot = await getDocs(q);
      const watchesData = querySnapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      setWatches(watchesData);
      setCurrentWatch(0);
    } catch (error) {
      console.error('Error fetching watches:', error);
    }
  };

  // -------------------------
  // 2) Get Top Styles
  // -------------------------
  const getTopStyles = (liked) => {
    const styleCounts = {};
    liked.forEach((watch) => {
      if (Array.isArray(watch.style)) {
        watch.style.forEach((st) => {
          styleCounts[st] = (styleCounts[st] || 0) + 1;
        });
      }
    });
    // Sort by frequency descending
    const sorted = Object.entries(styleCounts).sort((a, b) => b[1] - a[1]);
    const topTwo = sorted.slice(0, 2).map((entry) => entry[0]);
    return topTwo;
  };

  // -------------------------
  // 3) Load Data & Auth
  // -------------------------
  useEffect(() => {
    // On mount, fetch all
    fetchAllWatches();

    // Listen for auth changes
    const unsubscribe = onAuthStateChanged(auth, async (loggedInUser) => {
      setUser(loggedInUser);
      if (loggedInUser) {
        // fetchUserData checks if they have onboardingComplete
        const data = await fetchUserData(loggedInUser.uid);
        if (!data?.onboardingComplete) {
          setShowOnboarding(true);
        }
      } else {
        setUserData(null);
        setLikedWatches([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // -------------------------
  // 4) On 10 Liked => Filter
  // -------------------------
  useEffect(() => {
    if (likedWatches.length === 10) {
      const topStyles = getTopStyles(likedWatches);
      const recommended = watches.filter(
        (w) => Array.isArray(w.style) && w.style.some((s) => topStyles.includes(s))
      );
      setWatches(recommended);
      setCurrentWatch(0);
    }
  }, [likedWatches]);

  // -------------------------
  // Fetch user data
  // -------------------------
  const fetchUserData = async (userId) => {
    try {
      const q = query(collection(db, 'users'), where('userId', '==', userId));
      const userDoc = await getDocs(q);

      if (!userDoc.empty) {
        const data = userDoc.docs[0].data();
        setUserData(data);
        if (data.likedWatches) {
          setLikedWatches(data.likedWatches);
        }
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error fetching user data:', error);
      return null;
    }
  };

  // -------------------------
  // Google Sign-in
  // -------------------------
  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;

      // Check if doc already exists
      const userRef = doc(db, 'users', googleUser.uid);
      const existingSnap = await getDocs(
        query(collection(db, 'users'), where('userId', '==', googleUser.uid))
      );

      // If user doc doesn't exist, create it with onboardingComplete = false
      if (existingSnap.empty) {
        const firstName = googleUser.displayName
          ? googleUser.displayName.split(' ')[0]
          : '';
        const lastName = googleUser.displayName
          ? googleUser.displayName.split(' ').slice(1).join(' ')
          : '';

        await setDoc(userRef, {
          userId: googleUser.uid,
          firstName,
          lastName,
          email: googleUser.email,
          onboardingComplete: false,
        });
        setShowOnboarding(true);
      } else {
        // Doc exists. Let's see if onboardingComplete
        const data = existingSnap.docs[0].data();
        if (!data?.onboardingComplete) {
          setShowOnboarding(true);
        }
      }

      setShowAuth(false);
    } catch (error) {
      console.error('Google Sign-in error:', error);
    }
  };

  // -------------------------
  // Email/Password Auth
  // -------------------------
  const handleAuth = async (e) => {
    try {
      let userCredential;
      if (authMode === 'login') {
        userCredential = await signInWithEmailAndPassword(
          auth,
          formData.email,
          formData.password
        );
      } else {
        // Sign up
        userCredential = await createUserWithEmailAndPassword(
          auth,
          formData.email,
          formData.password
        );

        // If brand new user, set doc with onboardingComplete=false
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          userId: userCredential.user.uid,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          onboardingComplete: false,
        });

        setShowOnboarding(true);
      }
      setShowAuth(false);

      // Clear form
      setFormData({ firstName: '', lastName: '', email: '', password: '' });
    } catch (error) {
      console.error('Auth error:', error);
    }
  };

  // -------------------------
  // Onboarding Flow
  // -------------------------
  const handleOnboardingSubmit = async () => {
    try {
      if (!user) return;
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        wristSize: onboardingData.wristSize,
        ownedWatches: onboardingData.ownedWatches,
        onboardingComplete: true,
      });
      setShowOnboarding(false);
      fetchUserData(user.uid);
    } catch (error) {
      console.error('Error saving onboarding data:', error);
    }
  };

  const addOwnedWatch = (watchName) => {
    setOnboardingData((prev) => ({
      ...prev,
      ownedWatches: [...prev.ownedWatches, watchName],
    }));
  };

  const removeOwnedWatch = (index) => {
    setOnboardingData((prev) => ({
      ...prev,
      ownedWatches: prev.ownedWatches.filter((_, i) => i !== index),
    }));
  };

  // -------------------------
  // Searching Owned Watches
  // -------------------------
  useEffect(() => {
    if (!searchTerm) {
      setSearchResults([]);
      return;
    }
    // Filter by brand or name containing the searchTerm
    const results = watches.filter((w) => {
      const fullName = w.name.toLowerCase() + ' ' + w.brand.toLowerCase();
      return fullName.includes(searchTerm.toLowerCase());
    });

    setSearchResults(results);
  }, [searchTerm, watches]);

  // -----------
  // Sign Up / Log In Form
  // -----------
  const SignUpForm = () => {
    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      try {
        await handleAuth(e);
      } catch (error) {
        console.error('Form submission error:', error);
      }
    };

    return (
      <div className="bg-white border border-gray-200 p-12 rounded-2xl max-w-2xl w-full mx-auto">
        <h2 className="text-2xl font-bold mb-6">
          {authMode === 'signup' ? 'Sign up for Watch App' : 'Log in to Watch App'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {authMode === 'signup' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  First Name*
                </label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2"
                  required
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Last Name*
                </label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2"
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">Email*</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Password*</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              required
            />
            {authMode === 'signup' && (
              <p className="text-xs text-gray-500 mt-1">Minimum 6 characters</p>
            )}
          </div>

          <button
            type="submit"
            className="w-full bg-cyan-900 text-white py-2 px-4 rounded-md hover:bg-cyan-800"
          >
            {authMode === 'signup' ? 'Get Started' : 'Log In'}
          </button>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="w-full border border-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-50 flex items-center justify-center gap-2"
          >
            Continue with Google
          </button>

          {authMode === 'signup' ? (
            <p className="text-center text-sm text-gray-600">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className="text-cyan-900 hover:text-cyan-800"
              >
                Log In
              </button>
            </p>
          ) : (
            <p className="text-center text-sm text-gray-600">
              Don't have an account yet?{' '}
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className="text-cyan-900 hover:text-cyan-800"
              >
                Sign Up
              </button>
            </p>
          )}
        </form>
      </div>
    );
  };

  // -----------
  // Onboarding Screen
  // -----------
  const OnboardingScreen = () => (
    <div className="bg-white p-6 rounded-lg max-w-md w-full mx-auto">
      <h2 className="text-2xl font-bold mb-6">Hello {userData?.firstName}!</h2>

      <div className="space-y-6">
        {/* Wrist size */}
        <div>
          <div className="flex items-center gap-2">
            <label className="block text-sm font-medium text-gray-700">
              What's your wrist size?
            </label>
            <HelpCircle className="w-4 h-4 text-gray-400" />
          </div>
          <div className="mt-1 relative">
            <input
              type="number"
              value={onboardingData.wristSize}
              onChange={(e) =>
                setOnboardingData({ ...onboardingData, wristSize: e.target.value })
              }
              className="block w-full rounded-md border-gray-300 shadow-sm pr-24"
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              <span className="text-gray-500">centimeters</span>
            </div>
          </div>
          <button className="text-sm text-gray-500 mt-1">I don't know my wrist size</button>
        </div>

        {/* Owned Watches */}
        <div>
          <div className="flex items-center gap-2">
            <label className="block text-sm font-medium text-gray-700">
              Add Already Owned Watches
            </label>
            <HelpCircle className="w-4 h-4 text-gray-400" />
          </div>
          <div className="mt-2">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search brand or model"
                className="block w-full rounded-md border-gray-300 shadow-sm pl-10"
              />
            </div>

            {/* Show matching search results from Firestore-based watches */}
            {searchResults.length > 0 && (
              <div className="border border-gray-200 rounded-md max-h-48 overflow-y-auto">
                {searchResults.map((w) => (
                  <div
                    key={w.id}
                    className="px-3 py-2 hover:bg-gray-50 flex justify-between items-center"
                  >
                    <span className="text-sm">
                      {w.brand} - {w.name}
                    </span>
                    <button
                      onClick={() => {
                        addOwnedWatch(w.name);
                      }}
                      className="text-cyan-900 hover:text-cyan-700 text-xs underline"
                    >
                      <CirclePlus className="w-6 h-6" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 space-y-2">
              {onboardingData.ownedWatches.map((watch, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-2 border-b"
                >
                  <span>{watch}</span>
                  <button
                    onClick={() => removeOwnedWatch(index)}
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleOnboardingSubmit}
          className="w-full bg-cyan-900 text-white py-2 px-4 rounded-md hover:bg-cyan-800"
        >
          Finish
        </button>
      </div>
    </div>
  );

  // -----------
  // Profile Modal
  // -----------
  const ProfileModal = () => {
    const [editingWristSize, setEditingWristSize] = useState(false);
    const [newWristSize, setNewWristSize] = useState(userData?.wristSize || '');

    const handleUpdateWristSize = async () => {
      try {
        if (!user) return;
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, { wristSize: newWristSize });
        // Refresh local data
        fetchUserData(user.uid);
        setEditingWristSize(false);
      } catch (error) {
        console.error('Error updating wrist size:', error);
      }
    };

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
        <div className="bg-white p-6 rounded-lg max-w-md w-full relative">
          <button
            onClick={() => setShowProfile(false)}
            className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold mb-4">Your Profile</h2>

          {userData ? (
            <div>
              <p className="font-semibold">
                {userData.firstName} {userData.lastName}
              </p>
              <p className="text-sm text-gray-600 mb-4">{userData.email}</p>

              {/* Wrist size display / edit */}
              {!editingWristSize ? (
                <div className="mb-3">
                  <p className="mb-1">
                    <span className="font-semibold">Wrist size:</span>{' '}
                    {userData.wristSize ? `${userData.wristSize} cm` : 'Not set yet'}
                  </p>
                  <button
                    onClick={() => setEditingWristSize(true)}
                    className="text-cyan-900 hover:text-cyan-700 text-sm underline"
                  >
                    {userData.wristSize ? 'Edit wrist size' : 'Add wrist size'}
                  </button>
                </div>
              ) : (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Update Wrist Size (cm)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={newWristSize}
                      onChange={(e) => setNewWristSize(e.target.value)}
                      className="block w-full rounded-md border-gray-300 shadow-sm"
                    />
                    <button
                      onClick={handleUpdateWristSize}
                      className="bg-cyan-900 text-white px-3 py-1 rounded-md hover:bg-cyan-800"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingWristSize(false);
                        setNewWristSize(userData.wristSize || '');
                      }}
                      className="px-3 py-1 rounded-md border border-gray-300 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Owned Watches */}
              {userData.ownedWatches && userData.ownedWatches.length > 0 ? (
                <div className="mt-3">
                  <p className="font-semibold mb-1">Owned Watches:</p>
                  <ul className="list-disc ml-6 space-y-1 text-sm">
                    {userData.ownedWatches.map((owned, idx) => (
                      <li key={idx}>{owned}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-gray-500 mt-2">
                  You have no owned watches listed.
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-600">No user info loaded.</p>
          )}
        </div>
      </div>
    );
  };

  // -----------
  // Saved (Liked) Modal
  // -----------
  const SavedModal = () => {
    const handleRemoveWatch = async (watch) => {
      try {
        if (!user) return;
        setLikedWatches((prev) => prev.filter((w) => w.id !== watch.id));

        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          likedWatches: arrayRemove(watch),
        });
      } catch (error) {
        console.error('Error removing watch:', error);
      }
    };

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
        <div className="bg-white p-6 rounded-lg max-w-md w-full relative">
          <button
            onClick={() => setShowSaved(false)}
            className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold mb-4">Saved Watches</h2>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {likedWatches && likedWatches.length > 0 ? (
              likedWatches.map((watch) => (
                <div
                  key={watch.id}
                  className="flex justify-between items-center border py-2 px-2 text-sm bg-gray-100 rounded-md"
                >
                  <div>
                    <p>
                      {watch.name} ({watch.brand})
                    </p>
                    <p className="text-cyan-900 font-bold">
                      ${watch.price.toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemoveWatch(watch)}
                    className="text-red-500 hover:text-red-600 border border-gray-300 p-2 rounded-md"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">
                You haven’t liked any watches yet.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  // -----------
  // Main Return
  // -----------
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-bold">The Watch App</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  className="text-gray-500 hover:text-gray-700 border-2 border-gray-200 p-2 rounded-lg"
                  onClick={() => setShowProfile(true)}
                >
                  <User className="w-6 h-6" />
                </button>

                <button
                  className="text-gray-500 hover:text-gray-700 border-2 border-gray-200 p-2 rounded-lg"
                  onClick={() => setShowSaved(true)}
                >
                  <Heart className="w-6 h-6" />
                </button>
              </div>
              {user ? (
                <button
                  onClick={() => signOut(auth)}
                  className="bg-gradient-to-b from-cyan-700 to-cyan-800 text-white px-4 py-2 rounded-lg hover:bg-cyan-800 shadow-inner shadow-white/20 ring-1 ring-cyan-700"
                >
                  Sign Out
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setAuthMode('login');
                      setShowAuth(true);
                    }}
                    className="text-cyan-900 hover:text-cyan-800"
                  >
                    Log In
                  </button>
                  <button
                    onClick={() => {
                      setAuthMode('signup');
                      setShowAuth(true);
                    }}
                    className="bg-gradient-to-b from-cyan-700 to-cyan-800 text-white px-4 py-2 rounded-lg hover:bg-cyan-800 shadow-inner shadow-white/20 ring-1 ring-cyan-700"
                  >
                    Sign Up
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Auth Form */}
        {showAuth && <SignUpForm />}

        {/* Onboarding Screen */}
        {showOnboarding && <OnboardingScreen />}

        {/* Watch "Tinder" Cards */}
        {!showAuth && !showOnboarding && (
          <>
            {!user ? (
              // HERO if user is NOT logged in
              <div className="mx-auto text-center py-16 px-4 mt-8">
                <div className="w-36 flex mx-auto justify-center mb-6 text-sm rounded-full bg-gray-100 border border-gray-200 py-1"> Version Alpha 0.1</div>
                <h2 className="text-5xl flex mx-auto max-w-5xl justify-center font-bold text-gray-900 mb-4">
                  Swipe right on Watches.
                  It’s like Tinder, but these matches never ghost you...
                </h2>
                <p className="text-gray-500 text-xl max-w-lg flex mx-auto justify-center mb-6">
                  Save your favorites, explore personalized recommendations,
                  and build your collection.
                </p>
                <div className="flex justify-center gap-4">
                  <button
                    onClick={() => {
                      setAuthMode('signup');
                      setShowAuth(true);
                    }}
                    className="bg-gradient-to-b text-xl from-cyan-700 to-cyan-800 text-white px-4 py-2 rounded-lg hover:bg-cyan-800 shadow-inner shadow-white/20 ring-1 ring-cyan-700"
                  >
                    Get Matching
                  </button>
                  <button
                    onClick={() => {
                      setAuthMode('signup');
                      setShowAuth(true);
                    }}
                    className="bg-cyan-50 font-semibold text-cyan-800 px-4 py-3 text-xl rounded-lg border border-cyan-200 hover:bg-cyan-100"
                  >
                    Learn More
                  </button>
                </div>
              </div>
            ) : (
              // WATCH "TINDER" CARDS if user IS logged in
              <div className="max-w-md mx-auto">
                {watches.length > 0 && currentWatch < watches.length ? (
                  <div className="bg-gray-100 rounded-3xl overflow-hidden">
                    {/* Square image wrapper */}
                    <div className="m-8 rounded-xl border-2 border-gray-200 aspect-square overflow-hidden">
                      <img
                        src={watches[currentWatch].image}
                        alt={watches[currentWatch].name}
                        className="object-cover w-full h-full"
                      />
                    </div>

                    <div className="px-8 pb-8">
                      {/* Brand & Valuation */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-md tracking-wider uppercase text-gray-500">
                          {watches[currentWatch].brand}
                        </span>
                        <span className="text-md tracking-wider uppercase text-gray-500">
                          Valuation
                        </span>
                      </div>

                      {/* Name & Price */}
                      <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-gray-900">
                          {watches[currentWatch].name}
                        </h2>
                        <p className="text-2xl font-bold text-cyan-800">
                          ${watches[currentWatch].price.toLocaleString()}
                        </p>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex mt-6 w-full gap-2">
                        <button
                          onClick={() => {
                            // Dislike -> next
                            if (currentWatch < watches.length - 1) {
                              setCurrentWatch((prev) => prev + 1);
                            }
                          }}
                          className="flex-1 inline-flex items-center uppercase tracking-wide justify-center 
                                     rounded-xl border-2 border-gray-200 bg-white 
                                     py-3 font-semibold text-black 
                                     hover:bg-red-500 hover:text-white"
                        >
                          <HeartOff className="w-5 h-5 mr-2" />
                          Dislike
                        </button>

                        <button
                          onClick={async () => {
                            const currentWatchData = watches[currentWatch];
                            if (!user) {
                              setShowAuth(true);
                              return;
                            }
                            // Save to liked
                            setLikedWatches((prev) => [...prev, currentWatchData]);
                            const userRef = doc(db, 'users', user.uid);
                            await updateDoc(userRef, {
                              likedWatches: arrayUnion(currentWatchData),
                            });
                            if (currentWatch < watches.length - 1) {
                              setCurrentWatch((prev) => prev + 1);
                            }
                          }}
                          className="flex-1 inline-flex items-center uppercase tracking-wide justify-center 
                                     rounded-xl bg-gradient-to-b from-cyan-700 to-cyan-800 
                                     shadow-inner shadow-white/50 py-3 font-semibold text-white 
                                     hover:bg-cyan-700"
                        >
                          <Heart className="w-5 h-5 mr-2" />
                          Like
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-xl text-gray-600">No more watches to show!</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Profile Modal */}
      {showProfile && <ProfileModal />}

      {/* Saved Watches Modal */}
      {showSaved && <SavedModal />}
    </div>
  );
};

export default WatchApp;