export interface Farm {
  id: string;
  name: string;
  category: string;
  location: string;
  description: string;
  rating: number;
  time: string;
  deliveryFee: number;
  operatingHours: string;
  contactInfo: string;
  image: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
}

export const mockFarms: Farm[] = [
  {
    id: 'farm1',
    name: 'Dela Cruz Organic Farm',
    category: 'Vegetables',
    location: 'Science City of Munoz, Nueva Ecija',
    description: 'Family-owned organic vegetable farm specializing in pesticide-free greens and root crops.',
    rating: 4.8,
    time: '1–2 hrs',
    deliveryFee: 50,
    operatingHours: 'Mon–Sat, 6:00 AM – 5:00 PM',
    contactInfo: '+63 912 345 6789',
    image: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600',
  },
  {
    id: 'farm2',
    name: 'Benguet Strawberry Farm',
    category: 'Strawberries',
    location: 'La Trinidad, Benguet',
    description: 'Highland strawberry farm with fresh, sweet varieties harvested daily.',
    rating: 4.9,
    time: '2–3 hrs',
    deliveryFee: 80,
    operatingHours: 'Daily, 7:00 AM – 4:00 PM',
    contactInfo: '+63 917 123 4567',
    image: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=600',
  },
  {
    id: 'farm3',
    name: 'Santos Fruit Orchard',
    category: 'Fruits',
    location: 'Davao City, Davao del Sur',
    description: 'Premium tropical fruits including mangoes, durian, and bananas from our family orchard.',
    rating: 4.7,
    time: '3–4 hrs',
    deliveryFee: 120,
    operatingHours: 'Mon–Fri, 8:00 AM – 6:00 PM',
    contactInfo: '+63 918 765 4321',
    image: 'https://images.unsplash.com/photo-1519996529931-28324d5a630e?w=600',
  },
  {
    id: 'farm4',
    name: 'Reyes Dairy & Greens',
    category: 'Dairy',
    location: 'Urdaneta, Pangasinan',
    description: 'Organic dairy products and fresh mixed greens from a sustainable, pasture-raised farm.',
    rating: 4.6,
    time: '2–3 hrs',
    deliveryFee: 60,
    operatingHours: 'Daily, 5:00 AM – 3:00 PM',
    contactInfo: '+63 920 111 2233',
    image: 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=600',
  },
  {
    id: 'farm5',
    name: 'Palawan Seafood & Produce',
    category: 'Seafood & Produce',
    location: 'Puerto Princesa, Palawan',
    description: 'Fresh catch from Palawan waters paired with locally grown tropical produce.',
    rating: 4.5,
    time: '4–5 hrs',
    deliveryFee: 150,
    operatingHours: 'Mon–Sat, 5:00 AM – 2:00 PM',
    contactInfo: '+63 916 999 8877',
    image: 'https://images.unsplash.com/photo-1505576633757-0ac1084af824?w=600',
  },
  {
    id: 'farm6',
    name: 'Cordillera Mixed Produce',
    category: 'Mixed Produce',
    location: 'Baguio City, Benguet',
    description: 'Assorted highland vegetables, herbs, and flowers cultivated in the cool mountain climate.',
    rating: 4.8,
    time: '2–3 hrs',
    deliveryFee: 70,
    operatingHours: 'Tue–Sun, 6:00 AM – 4:00 PM',
    contactInfo: '+63 919 444 5566',
    image: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=600',
  },
];

export const mockProducts: Record<string, Product[]> = {
  farm1: [
    { id: 'p1-1', name: 'Pechay', description: 'Fresh Chinese cabbage, locally grown without pesticides', price: 45, image: 'https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?w=400', category: 'Leafy Greens' },
    { id: 'p1-2', name: 'Kangkong', description: 'Water spinach, harvested this morning', price: 30, image: 'https://images.unsplash.com/photo-1601648764658-cf37e8c89b70?w=400', category: 'Leafy Greens' },
    { id: 'p1-3', name: 'Camote', description: 'Sweet potato, organically grown', price: 60, image: 'https://images.unsplash.com/photo-1571680327030-49e38b34fde0?w=400', category: 'Root Crops' },
    { id: 'p1-4', name: 'Ampalaya', description: 'Bitter melon, good for blood sugar levels', price: 55, image: 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=400', category: 'Vegetables' },
  ],
  farm2: [
    { id: 'p2-1', name: 'Fresh Strawberries (250g)', description: 'Sweet highland strawberries picked at peak ripeness', price: 120, image: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=400', category: 'Berries' },
    { id: 'p2-2', name: 'Strawberry Jam (200g)', description: 'Homemade jam with no artificial preservatives', price: 180, image: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=400', category: 'Processed' },
    { id: 'p2-3', name: 'Strawberry Pack (500g)', description: 'Bulk pack, ideal for smoothies and desserts', price: 220, image: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=400', category: 'Berries' },
  ],
  farm3: [
    { id: 'p3-1', name: 'Carabao Mango (1kg)', description: 'The National Fruit of the Philippines, sweet and creamy', price: 150, image: 'https://images.unsplash.com/photo-1519996529931-28324d5a630e?w=400', category: 'Tropical Fruits' },
    { id: 'p3-2', name: 'Lakatan Banana (1 hand)', description: 'Ripe and sweet, great for breakfast', price: 60, image: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400', category: 'Tropical Fruits' },
    { id: 'p3-3', name: 'Durian (1 piece)', description: 'Davao premium durian, rich and aromatic', price: 350, image: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=400', category: 'Tropical Fruits' },
  ],
  farm4: [
    { id: 'p4-1', name: 'Fresh Milk (1L)', description: 'Pasteurized whole milk from grass-fed cows', price: 95, image: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400', category: 'Dairy' },
    { id: 'p4-2', name: 'Salad Greens Mix (100g)', description: 'Mixed lettuce, arugula, and herbs', price: 80, image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400', category: 'Greens' },
  ],
  farm5: [
    { id: 'p5-1', name: 'Tilapia (1kg)', description: 'Fresh water tilapia from clean fish pens', price: 130, image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400', category: 'Fish' },
    { id: 'p5-2', name: 'Prawns (500g)', description: 'Freshwater prawns, cleaned and deveined', price: 280, image: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=400', category: 'Seafood' },
  ],
  farm6: [
    { id: 'p6-1', name: 'Broccoli (head)', description: 'Fresh highland broccoli, crisp and nutrient-rich', price: 85, image: 'https://images.unsplash.com/photo-1459411621453-7b03977f4bfc?w=400', category: 'Vegetables' },
    { id: 'p6-2', name: 'Sayote (2 pcs)', description: 'Chayote, great for soups and stir-fries', price: 40, image: 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400', category: 'Vegetables' },
    { id: 'p6-3', name: 'Carrots (500g)', description: 'Locally grown sweet carrots', price: 55, image: 'https://images.unsplash.com/photo-1447175008436-054170c2e979?w=400', category: 'Root Crops' },
  ],
};

export const mockOrders = [
  {
    id: 'CB-2024-1042',
    merchant: 'Dela Cruz Organic Farm',
    dateBought: 'Apr 20, 2024',
    status: 'Shipped',
    totalAmount: 285,
    deliveryFee: 50,
    timeOfArrival: 'Apr 22, 2024 10:00 AM',
    shipped: true,
    image: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=200',
  },
  {
    id: 'CB-2024-1031',
    merchant: 'Benguet Strawberry Farm',
    dateBought: 'Apr 15, 2024',
    status: 'Delivered',
    totalAmount: 420,
    deliveryFee: 80,
    timeOfArrival: 'Apr 17, 2024 2:00 PM',
    shipped: true,
    image: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=200',
  },
  {
    id: 'CB-2024-1019',
    merchant: 'Santos Fruit Orchard',
    dateBought: 'Apr 10, 2024',
    status: 'Processing',
    totalAmount: 560,
    deliveryFee: 120,
    timeOfArrival: 'TBD',
    shipped: false,
    image: 'https://images.unsplash.com/photo-1519996529931-28324d5a630e?w=200',
  },
];
