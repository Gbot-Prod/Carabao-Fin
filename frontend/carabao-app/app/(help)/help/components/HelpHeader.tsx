import Image from 'next/image';
import { appUrl, helpUrl, merchantUrl } from '@/lib/urls';
import Logo from '@/public/images/icons/carabaoLogo.png';
import styles from '../header.module.css';
import HelpSearch from './HelpSearch';

// Green header for help.<root>: logo (home of help), FAQ search, and links
// out to the buyer site (apex) and the farmer site (merchant.<root>).
export default function HelpHeader() {
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <a className={styles.brand} href={helpUrl('/')} aria-label="Carabao Help home">
          <Image src={Logo} alt="" className={styles.logo} priority />
          <span className={styles.brandName}>Carabao</span>
          <span className={styles.brandSub}>Help</span>
        </a>
        <HelpSearch />
        <nav className={styles.sites} aria-label="Carabao sites">
          <a className={styles.siteLink} href={appUrl('/order')}>Buyer site</a>
          <a className={styles.siteLink} href={merchantUrl('/')}>Farmer site</a>
        </nav>
      </div>
    </header>
  );
}
