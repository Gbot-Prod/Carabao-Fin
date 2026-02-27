export interface Farm {
  name: string;
  rating: number;
  reviews: string;
  time: string;
  badge: string;
  category: string;
  deliveryFee: number;
  promo: string;
  image: string;
}

export const farms: Farm[] = [
  {
    name: 'DOLE',
    rating: 5,
    reviews: '(1000+)',
    time: '6 Days',
    badge: '₱₱',
    category: 'Filipino',
    deliveryFee: 453,
    promo: 'Free with ₱2000',
    image: '/images/farms/dole.jpg'
  },

  {
    name: 'DIZON',
    rating: 4.3,
    reviews: '(1000+)',
    time: '3 Days',
    badge: '₱₱',
    category: 'Filipino',
    deliveryFee: 356,
    promo: 'Free with ₱2000',
    image: '/images/farms/dizon.png'
  },

  {
    name: 'placeholder',
    rating: 0,
    reviews: 'placeholder',
    time: 'placeholder',
    badge: 'placeholder',
    category: 'placeholder',
    deliveryFee: 0,
    promo: 'placeholder',
    image: ''
  },
  
  {
    name: 'placeholder',
    rating: 0,
    reviews: 'placeholder',
    time: 'placeholder',
    badge: 'placeholder',
    category: 'placeholder',
    deliveryFee: 0,
    promo: 'placeholder',
    image: ''
  },

  {
    name: 'placeholder',
    rating: 0,
    reviews: 'placeholder',
    time: 'placeholder',
    badge: 'placeholder',
    category: 'placeholder',
    deliveryFee: 0,
    promo: 'placeholder',
    image: ''
  },

  {
    name: 'placeholder',
    rating: 0,
    reviews: 'placeholder',
    time: 'placeholder',
    badge: 'placeholder',
    category: 'placeholder',
    deliveryFee: 0,
    promo: 'placeholder',
    image: ''
  },

  {
    name: 'placeholder',
    rating: 0,
    reviews: 'placeholder',
    time: 'placeholder',
    badge: 'placeholder',
    category: 'placeholder',
    deliveryFee: 0,
    promo: 'placeholder',
    image: ''
  },

  // ...more restaurants
];

