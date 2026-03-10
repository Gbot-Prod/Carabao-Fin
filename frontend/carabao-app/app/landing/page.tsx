"use client";

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';
import { SignIn } from '@clerk/nextjs';

function Landing() {
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isLogin = authMode === 'login';
  const router = useRouter();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/signup';
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : {
          full_name: formData.fullName,
          email: formData.email,
          password: formData.password,
          confirm_password: formData.confirmPassword,
        };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Authentication failed');
      }

      const data = await response.json();
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      router.push('/order');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SignIn routing="hash" />

    /*
    <div className={styles.container}>
      <h1>Welcome to Carabao</h1>
      <p>Your one-stop solution for farm-to-table delivery.</p>
      <div className={styles.authenticationContainer}>
        <div className={styles.switchContainer}>
          <button
            type="button"
            className={`${styles.switchButton} ${isLogin ? styles.activeSwitch : ''}`}
            onClick={() => setAuthMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={`${styles.switchButton} ${!isLogin ? styles.activeSwitch : ''}`}
            onClick={() => setAuthMode('signup')}
          >
            Sign Up
          </button>
        </div>

        {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

        <form className={styles.form} onSubmit={handleSubmit}>
          {!isLogin && (
            <input
              type="text"
              name="fullName"
              placeholder="Full Name"
              className={styles.input}
              value={formData.fullName}
              onChange={handleInputChange}
              required
            />
          )}

          <input
            type="email"
            name="email"
            placeholder="Email"
            className={styles.input}
            value={formData.email}
            onChange={handleInputChange}
            required
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            className={styles.input}
            value={formData.password}
            onChange={handleInputChange}
            required
          />

          {!isLogin && (
            <input
              type="password"
              name="confirmPassword"
              placeholder="Confirm Password"
              className={styles.input}
              value={formData.confirmPassword}
              onChange={handleInputChange}
              required
            />
          )}

          <button className={styles.button} type="submit" disabled={isLoading}>
            {isLoading ? 'Loading...' : isLogin ? 'Login' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
    */
  );
}

export default Landing;