import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { auth, db } from '../../firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import './SignUp.css';

const sideImage = '/assets/side.jpg';
const bgImage = '/assets/bg.jpg';


export default function Signup() {
  const [formValues, setFormValues] = useState({
    name: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormValues({ ...formValues, [e.target.name]: e.target.value });
  };

  const validate = () => {
    const newErrors = {};
    if (!formValues.name.trim()) newErrors.name = 'Name is required';
    if (!formValues.email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formValues.email))
      newErrors.email = 'Email is invalid';
    if (!formValues.username.trim())
      newErrors.username = 'Username is required';
    if (!formValues.password)
      newErrors.password = 'Password is required';
    else if (formValues.password.length < 6)
      newErrors.password = 'Password must be at least 6 characters';
    if (formValues.password !== formValues.confirmPassword)
      newErrors.confirmPassword = 'Passwords do not match';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formValues.email,
        formValues.password
      );

      const user = userCredential.user;

      await setDoc(doc(db, 'users', user.uid), {
        name: formValues.name,
        username: formValues.username,
        email: formValues.email,
        createdAt: new Date(),
      });
    } catch (error) {
      console.error('Signup error:', error.message);
    }

    setTimeout(() => setLoading(false), 2000);
  };

  return (
    <div
      className="signup-container"
      style={{ backgroundImage: `url(${bgImage})` }}
    >
      <div className="signup-card">
        <h2 className="signup-title">Sign Up</h2>

        <form onSubmit={handleSubmit} className="signup-form">
          <div className="form-control">
            <label>Name</label>
            <input
              name="name"
              value={formValues.name}
              onChange={handleChange}
            />
            {errors.name && <span className="error">{errors.name}</span>}
          </div>

          <div className="form-control">
            <label>Email</label>
            <input
              type="email"
              name="email"
              value={formValues.email}
              onChange={handleChange}
            />
            {errors.email && <span className="error">{errors.email}</span>}
          </div>

          <div className="form-control">
            <label>Username</label>
            <input
              name="username"
              value={formValues.username}
              onChange={handleChange}
            />
            {errors.username && (
              <span className="error">{errors.username}</span>
            )}
          </div>

          <div className="form-control">
            <label>Password</label>
            <input
              type="password"
              name="password"
              value={formValues.password}
              onChange={handleChange}
            />
            {errors.password && (
              <span className="error">{errors.password}</span>
            )}
          </div>

          <div className="form-control">
            <label>Confirm Password</label>
            <input
              type="password"
              name="confirmPassword"
              value={formValues.confirmPassword}
              onChange={handleChange}
            />
            {errors.confirmPassword && (
              <span className="error">{errors.confirmPassword}</span>
            )}
          </div>

          <button type="submit" disabled={loading}>
            {loading ? (
              <span className="loader"></span>
            ) : (
              'Sign Up'
            )}
          </button>
        </form>

        <p className="signin-link">
          Already have an account? <Link to="/">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
