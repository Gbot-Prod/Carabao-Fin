'use client';

import { useParams } from 'next/navigation';
import styles from './page.module.css';

// Mock data - replace with actual API call
const merchantData = {
  id: '1',
  name: 'Kobe Dairy Farm',
  location: 'Tagaytay, Cavite',
  description: 'Fresh dairy and produce directly from our farm to your table.',
  rating: 4.8,
  deliveryTime: '2-3 days',
  operatingHours: 'Mon - Sat, 8:00 AM - 6:00 PM',
  contactInfo: '+63 917-123-4567',
  image: '/images/others/kobe.avif',
};

const products = [
  {
    id: '1',
    name: 'Fresh Carabao Milk',
    price: '₱85',
    image: '/images/farms/milk.jpg',
    category: 'Dairy',
  },
  {
    id: '2',
    name: 'White Cheese (500g)',
    price: '₱320',
    image: '/images/farms/cheese.jpg',
    category: 'Dairy',
  },
  {
    id: '3',
    name: 'Organuc Thai Basil',
    price: '₱65',
    image: '/images/farms/basil.jpg',
    category: 'Vegetables',
  },
  {
    id: '4',
    name: 'Fresh Tomatoes (1kg)',
    price: '₱120',
    image: '/images/farms/tomatoes.jpg',
    category: 'Vegetables',
  },
  {
    id: '5',
    name: 'Carabao Yogurt',
    price: '₱95',
    image: '/images/farms/yogurt.jpg',
    category: 'Dairy',
  },
  {
    id: '6',
    name: 'Papaya (5pcs)',
    price: '₱180',
    image: '/images/farms/papaya.jpg',
    category: 'Fruits',
  },
  {
    id: '7',
    name: 'Organic Spinach Bundle',
    price: '₱75',
    image: '/images/farms/spinach.jpg',
    category: 'Vegetables',
  },
  {
    id: '8',
    name: 'Fresh Mangoes (6pcs)',
    price: '₱250',
    image: '/images/farms/mangoes.jpg',
    category: 'Fruits',
  },
];

export default function MerchantPage() {
  const params = useParams();
  const merchantId = params.merchantID;

  const handleAddToCart = (productName: string) => {
    alert(`${productName} added to cart!`);
  };

  return (
    <div className={styles.page}>
      {/* Merchant Header */}
      <header className={styles.merchantHeader}>
        <img src={merchantData.image} alt={merchantData.name} className={styles.merchantImage} />

        <div className={styles.merchantInfo}>
          <h1 className={styles.merchantName}>{merchantData.name}</h1>
          <p className={styles.merchantLocation}>📍 {merchantData.location}</p>
          <p className={styles.merchantDesc}>{merchantData.description}</p>

          <div className={styles.details}>
            <div className={styles.detailItem}>
              <span className={styles.label}>Rating</span>
              <span className={styles.value}>⭐ {merchantData.rating}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.label}>Delivery</span>
              <span className={styles.value}>{merchantData.deliveryTime}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.label}>Hours</span>
              <span className={styles.value}>{merchantData.operatingHours}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.label}>Contact</span>
              <span className={styles.value}>{merchantData.contactInfo}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Products Section */}
      <section className={styles.productsSection}>
        <h2>Fresh Produce & Dairy</h2>

        <div className={styles.productsGrid}>
          {products.map((product) => (
            <article key={product.id} className={styles.productCard}>
              <div className={styles.productImage}>
                <img src={product.image} alt={product.name} />
                <span className={styles.badge}>{product.category}</span>
              </div>

              <div className={styles.productBody}>
                <h3>{product.name}</h3>
                <p className={styles.price}>{product.price}</p>
                <button
                  className={styles.addBtn}
                  onClick={() => handleAddToCart(product.name)}
                >
                  Add to Cart
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
