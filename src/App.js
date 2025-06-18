// frontend/src/App.js
import React, { useState, useRef, useEffect } from 'react';
import Webcam from 'react-webcam';
import Avatar from './Avatar.js';

function App() {
  const [appState, setAppState] = useState('welcome'); 
  const [userName, setUserName] = useState('');
  const [status, setStatus] = useState('Scanning for face...');
  const [signupName, setSignupName] = useState('');
  const [capturedImage, setCapturedImage] = useState(null);
  const [signupError, setSignupError] = useState('');
  const webcamRef = useRef(null);
  const intervalRef = useRef(null);

  // Get API base URL
  const getApiBase = () => {
    return process.env.NODE_ENV === 'production' 
      ? ''  // Use relative path in production
      : 'http://localhost:5000';  // Use full URL in development
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Start face recognition
  const startRecognition = () => {
    setAppState('recognizing');
    setStatus('Scanning for face...');
    
    intervalRef.current = setInterval(() => {
      captureAndRecognize();
    }, 2000);
  };

  // Capture image and send for recognition
  const captureAndRecognize = async () => {
    const imageSrc = webcamRef.current?.getScreenshot();
    const API_BASE = getApiBase();
    
    if (!imageSrc) {
      setStatus('Failed to capture image');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageSrc })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.status === 'known') {
        clearInterval(intervalRef.current);
        setUserName(result.name);
        setAppState('loggedIn');
      } 
      else if (result.status === 'unknown') {
        setStatus(result.message);
        if (window.confirm('Unknown user detected. Would you like to sign up?')) {
          clearInterval(intervalRef.current);
          setCapturedImage(imageSrc);
          setAppState('signup');
        } else {
          // Continue scanning if user declines signup
          setStatus('Scanning for face...');
        }
      }
      else if (result.status === 'no_face') {
        setStatus(result.message);
      }
      else {
        setStatus(`Error: ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  // Handle signup form submission
  const handleSignup = async (e) => {
    e.preventDefault();
    setSignupError('');
    
    const API_BASE = getApiBase();
    const formData = new FormData();
    formData.append('name', signupName);
    formData.append('image_data', capturedImage);
    
    const resumeFile = e.target.resume.files[0];
    if (resumeFile) {
      formData.append('resume', resumeFile);
    }

    try {
      const response = await fetch(`${API_BASE}/api/signup`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorResult = await response.json();
        throw new Error(errorResult.message || 'Signup failed');
      }

      const result = await response.json();
      
      if (result.status === 'success') {
        setUserName(result.name);
        setAppState('loggedIn');
        // Reset signup fields
        setSignupName('');
        setCapturedImage(null);
      } else {
        throw new Error(result.message || 'Signup failed');
      }
    } catch (error) {
      setSignupError(error.message);
    }
  };

  // Cancel recognition
  const cancelRecognition = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setAppState('welcome');
    // Reset signup fields
    setSignupName('');
    setCapturedImage(null);
    setSignupError('');
  };

  // Log out
  const logout = () => {
    setAppState('welcome');
    setUserName('');
    // Reset signup fields
    setSignupName('');
    setCapturedImage(null);
    setSignupError('');
  };

  // Render current screen based on app state
  return (
    <div className="app">
      {/* Welcome Screen */}
      {appState === 'welcome' && (
        <div className="welcome-screen">
          <h1>Welcome to the Digital Professor Assistant</h1>
          <button onClick={startRecognition}>Sign In</button>
        </div>
      )}

      {/* Recognition Screen */}
      {appState === 'recognizing' && (
        <div className="recognition-screen">
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            videoConstraints={{ facingMode: 'user' }}
            width="100%"
            height="auto"
          />
          <p>{status}</p>
          <button onClick={cancelRecognition}>Cancel</button>
        </div>
      )}

      {/* Logged In Screen */}
      {appState === 'loggedIn' && (
        <div className="loggedin-screen">
          <h1>Hello, {userName}!</h1>
          <div className="button-group">
            <button onClick={() => setAppState('avatar')}>Go to Avatar</button>
            <button onClick={logout}>Sign Out</button>
          </div>
        </div>
      )}

      {/* Avatar Screen */}
      {appState === 'avatar' && (
        <Avatar />
      )}

      {/* Signup Screen */}
      {appState === 'signup' && (
        <div className="signup-screen">
          <h2>Sign Up</h2>
          <form onSubmit={handleSignup}>
            <div>
              <label>Name:</label>
              <input 
                type="text" 
                value={signupName} 
                onChange={(e) => setSignupName(e.target.value)} 
                required 
              />
            </div>
            <div>
              <img src={capturedImage} alt="Captured" width={320} />
            </div>
            <div>
              <label>Resume (PDF):</label>
              <input 
                type="file" 
                name="resume" 
                accept=".pdf" 
                required 
              />
            </div>
            <div className="button-group">
              <button type="submit">Save</button>
              <button type="button" onClick={cancelRecognition}>Cancel</button>
            </div>
          </form>
          {signupError && <p className="error">{signupError}</p>}
        </div>
      )}
    </div>
  );
}

export default App;
