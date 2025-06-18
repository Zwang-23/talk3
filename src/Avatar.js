import React, { useEffect } from 'react';
import './styles.css'; // Import CSS directly
import { init } from './Avatar/main.js';
import { useRef } from 'react';

const Avatar = () => {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      init(); // Initialize the avatar system
      initialized.current = true;
    }
    

    return () => {
    };
  }, []);
 
  return (
    <div className="avatar-container">
      {/* JavaScript Disabled Warning */}
      <noscript>
        <div>
          <div>
            <h1 className="text-2xl font-bold mb-2">JavaScript Required</h1>
            <p>Please enable JavaScript to use the 3D assistant.</p>
          </div>
        </div>
      </noscript>

      {/* Header */}
      <header>3D Talking Avatar</header>

      {/* Collapsible Introduction Section */}
      <div id="intro-section">
        {"welcome"}
      </div>

      <div className="container">
        {/* Column 1: Scene + Selector */}
        <div className="scene-col">
          <div id="scene-container"></div>
          <select id="model-selector" aria-label="Select 3D model">
            <option value="pro.glb">Default model</option>
            <option value="ProfAbed_BlackTshirt.glb">Prof Abed (Black T-shirt)</option>
            <option value="ProfAbed_suit.glb">Prof Abed (Suit)</option>
          </select>
        </div>
        
        {/* Column 2: Chat + Input */}
        <div className="chat-col">
          <div id="chat-messages"></div>
          <div className="chat-input">
            <textarea id="user-input" placeholder="Type your message"></textarea>
            <button id="send-button">Send</button>
          </div>
        
          <div className="controls">
            <button id="mode-toggle">ChatGPT Mode</button>
            
            <button id="save-log">Save Log</button>
          </div>
        </div>
      </div>
      
      {/* Loading overlays */}
      <div id="loading-overlay">
        <div className="loading-spinner"></div>
        <p>Loading AI Assistant...</p>
      </div>
      <div id="processing-overlay">
        <div className="loading-spinner"></div>
        <p>Processing speech…</p>
      </div>
    </div>
  );
};

export default Avatar;