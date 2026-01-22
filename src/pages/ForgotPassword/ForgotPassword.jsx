import React from 'react';
import { useNavigate } from 'react-router-dom';
import './ForgotPassword.css';

export default function ForgotPassword() {
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    console.log('Email for password reset:', data.get('email'));
    alert('Password reset link sent (simulated).');
  };

  const handleCancel = () => {
    navigate('/');
  };

  return (
    <div className="forgot-container">
      <form className="forgot-card" onSubmit={handleSubmit}>
        <h2>Reset Password</h2>

        <p className="info-text">
          Contact your Site administrator to <br />
          Reset your password. <br />
          <strong>+91 8328273229</strong>
        </p>

        <input
          autoFocus
          required
          type="email"
          name="email"
          placeholder="Email address"
        />

        <div className="button-group">
          <button type="button" className="btn-outline" onClick={handleCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
