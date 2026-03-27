"use client";
import styles from './page.module.css';
import { SignIn } from '@clerk/nextjs';

function Landing() {
  return (
    <div className={styles.container}>
      <SignIn routing="hash" />
    </div>
  );
}

export default Landing;