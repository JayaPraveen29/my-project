import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase';
import './SignIn.css';

// Images
// Use direct public folder paths
const bgImage = '/assets/bg.jpg';
const sideImage = '/assets/side.jpg';



export default function SignIn() {
  const navigate = useNavigate();
  const [formValues, setFormValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormValues({ ...formValues, [e.target.name]: e.target.value });
  };

  const validate = () => {
    const newErrors = {};
    if (!formValues.email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formValues.email))
      newErrors.email = 'Email is invalid';

    if (!formValues.password) newErrors.password = 'Password is required';
    else if (formValues.password.length < 6)
      newErrors.password = 'Password must be at least 6 characters';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await signInWithEmailAndPassword(
        auth,
        formValues.email,
        formValues.password
      );
      navigate('/EntryPage');
    } catch (error) {
      alert(error.message);
    }
    setLoading(false);
  };

  return (
    <div
      className="outer-container"
      style={{ backgroundImage: `url(${bgImage})` }}
    >
      <div className="flex-card">
        {/* Left Image */}
        <div className="image-container">
          <img src={sideImage} alt="login visual" />
        </div>

        {/* Right Form */}
        <div className="form-card">
          <h3 className="title-small">SIEC-CT 2026</h3>
          <h2 className="title-main">Sign in</h2>

          <form onSubmit={handleSubmit} className="form">
            <div className="form-control">
              <label>Email</label>
              <input
                type="email"
                name="email"
                placeholder="your@email.com"
                value={formValues.email}
                onChange={handleChange}
              />
              {errors.email && <span className="error">{errors.email}</span>}
            </div>

            <div className="form-control">
              <label>Password</label>
              <input
                type="password"
                name="password"
                placeholder="••••••"
                value={formValues.password}
                onChange={handleChange}
              />
              {errors.password && (
                <span className="error">{errors.password}</span>
              )}
            </div>

            <button type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>

            <Link to="/forgotpassword" className="link-center">
              Forgot your password?
            </Link>
          </form>

          <div className="divider">or</div>

          <p className="signup-text">
            Don&apos;t have an account? <Link to="/signup">Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
