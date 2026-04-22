"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './page.module.css';
import { fetchOrderHistory, type OrderHistoryItem } from '@/util/api';

function PastOrderCard({ order }: { order: OrderHistoryItem }) {
  const merchantHref = order.merchant_id ? `/merchant/${order.merchant_id}` : null;

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '12px',
        marginTop: '12px',
      }}
    >
      <h3 style={{ margin: 0 }}>
        {merchantHref ? <Link href={merchantHref}>{order.merchant}</Link> : order.merchant}
      </h3>
      <p style={{ margin: '6px 0 0' }}>Order ID: {order.order_id}</p>
      <p style={{ margin: '4px 0 0' }}>Date: {new Date(order.order_date).toLocaleDateString()}</p>
      <p style={{ margin: '4px 0 0' }}>Total: ₱{order.total_amount.toLocaleString()}</p>
      <p style={{ margin: '4px 0 0' }}>Status: {order.status}</p>
    </div>
  );
}

function History() {
  const [pastOrders, setPastOrders] = useState<OrderHistoryItem[]>([]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const orders = await fetchOrderHistory();
        setPastOrders(orders);
      } catch {
        setPastOrders([]);
      }
    };

    void loadHistory();
  }, []);

  return (
    <div className={styles.container}>
      <h1>Order History</h1>
      <p>View your past orders and their details.</p>
      {pastOrders.length === 0 ? (
        <p style={{ marginTop: '12px' }}>No completed orders yet.</p>
      ) : (
        pastOrders.map((order) => (
          <PastOrderCard key={order.id} order={order} />
        ))
      )}
    </div>
  );
}

export default History;
