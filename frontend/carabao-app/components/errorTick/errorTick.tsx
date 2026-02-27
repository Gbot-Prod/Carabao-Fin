import React from 'react';
import './errorTick.css';

export type ErrorType =
  | 'email-used'
  | 'wrong-password'
  | 'invalid-date'
  | 'required-field'
  | 'invalid-format'
  | 'network-error'
  | 'generic';

interface ErrorTickProps {
  message?: string;
  type?: ErrorType;
  onClose?: () => void;
  isVisible?: boolean;
}

const errorMessages: Record<ErrorType, string> = {
  'email-used': 'This email address is already registered',
  'wrong-password': 'Incorrect password. Please try again',
  'invalid-date': 'The date you entered is invalid',
  'required-field': 'This field is required',
  'invalid-format': 'Invalid format. Please check your input',
  'network-error': 'Network error. Please check your connection',
  'generic': 'An error occurred. Please try again'
};

export default function ErrorTick({
  message,
  type = 'generic',
  onClose,
  isVisible = true
}: ErrorTickProps) {
  if (!isVisible) return null;

  const displayMessage = message || errorMessages[type];

  return (
    <div className="error-tick-container">
      <div className="error-tick-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M10 6V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="14" r="1" fill="currentColor" />
        </svg>
      </div>
      <div className="error-tick-message">{displayMessage}</div>
      {onClose && (
        <button
          className="error-tick-close"
          onClick={onClose}
          aria-label="Close error message"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 4L4 12M4 4L12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
