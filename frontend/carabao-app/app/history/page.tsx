import styles from './page.module.css';

type PastOrder = {
  id: string;
  farmName: string;
  totalAmount: string;
  orderDate: string;
  status: string;
};

function PastOrderCard({ order }: { order: PastOrder }) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '12px',
        marginTop: '12px',
      }}
    >
      <h3 style={{ margin: 0 }}>{order.farmName}</h3>
      <p style={{ margin: '6px 0 0' }}>Order ID: {order.id}</p>
      <p style={{ margin: '4px 0 0' }}>Date: {order.orderDate}</p>
      <p style={{ margin: '4px 0 0' }}>Total: {order.totalAmount}</p>
      <p style={{ margin: '4px 0 0' }}>Status: {order.status}</p>
    </div>
  );
}

function History() {
  const pastOrders: PastOrder[] = [
    {
      id: 'ORD-1001',
      farmName: 'Green Valley Farm',
      totalAmount: '₱12,500',
      orderDate: '2026-02-20',
      status: 'Delivered',
    },
    {
      id: 'ORD-1002',
      farmName: 'Sunrise Dairy Farm',
      totalAmount: '₱8,300',
      orderDate: '2026-02-10',
      status: 'Completed',
    },
  ];

  return (
    <div className={styles.container}>
      <h1>Order History</h1>
      <p>View your past orders and their details.</p>
      {pastOrders.map((order) => (
        <PastOrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

export default History;
