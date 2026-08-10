import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateTaskWizardPage from '../page';
import { useStellarWallet } from '@/context/StellarWalletContext';

jest.mock('@/context/StellarWalletContext');

describe('CreateTaskWizardPage', () => {
  beforeEach(() => {
    (useStellarWallet as jest.Mock).mockReturnValue({
      address: 'GSOURCE123',
      isConnected: true,
    });
  });

  it('renders step 1 by default and validates navigation', () => {
    render(<CreateTaskWizardPage />);

    expect(
      screen.getByRole('heading', { name: /step 1: specify target soroban contract/i })
    ).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/CA7Q3/i);
    fireEvent.change(input, { target: { value: 'CA7Q31234567890' } });

    fireEvent.click(screen.getByRole('button', { name: /next step/i }));

    expect(
      screen.getByRole('heading', { name: /step 2: function selection & arguments/i })
    ).toBeInTheDocument();
  });

  it('requires successful simulation before advancing from step 3', async () => {
    render(<CreateTaskWizardPage />);

    // Advance to step 2
    fireEvent.change(screen.getByPlaceholderText(/CA7Q3/i), {
      target: { value: 'CA7Q31234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));

    // Advance to step 3
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));
    expect(
      screen.getByRole('heading', { name: /step 3: trigger interval & pre-flight simulation/i })
    ).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /next step/i });
    expect(nextBtn).toBeDisabled();

    // Trigger simulation
    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));

    await waitFor(() => {
      expect(screen.getByText(/✓ Simulation Successful/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(nextBtn).not.toBeDisabled();
  });
});