import { Sidebar } from '@/components/app/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Sidebar />
      <div style={{ marginLeft: 244, minHeight: '100vh', padding: '40px 40px 80px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>{children}</div>
      </div>
    </div>
  );
}
