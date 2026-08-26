import type { Metadata } from 'next';
import { KeeperMarketplace } from './components/KeeperMarketplace';

export const metadata: Metadata = {
  title: 'Keeper Marketplace | SoroTask',
  description: 'Browse keeper profiles, view reliability stats, and place bids for priority task execution.',
};

export default function MarketplacePage() {
  return <KeeperMarketplace />;
}
