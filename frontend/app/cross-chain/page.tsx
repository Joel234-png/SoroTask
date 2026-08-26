import type { Metadata } from 'next';
import { CrossChainTaskManager } from './components/CrossChainTaskManager';

export const metadata: Metadata = {
  title: 'Cross-Chain Tasks | SoroTask',
  description: 'Manage and monitor tasks spanning Soroban and other integrated networks.',
};

export default function CrossChainPage() {
  return <CrossChainTaskManager />;
}
