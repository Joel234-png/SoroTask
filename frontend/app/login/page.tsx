/**
 * Login Page
 * Mock login interface for demonstration with Secure Enclave WebAuthn Integration
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useI18n';
import { useWebAuthn } from '@/hooks/useWebAuthn';

export default function LoginPage() {
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [enrollSuccessMessage, setEnrollSuccessMessage] = useState<string | null>(null);
  const { login, isLoading: isAuthLoading, error: authError } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  const {
    isSupported: isWebAuthnSupported,
    isPlatformAvailable: isBiometricsAvailable,
    isEnrolled: isDeviceEnrolled,
    isLoading: isWebAuthnLoading,
    error: webAuthnError,
    enrollDevice,
    authenticateDevice,
  } = useWebAuthn();

  const mockUsers = [
    {
      id: 'admin',
      name: 'Admin User',
      address: 'admin_address',
      role: 'admin',
      description: 'Full system access'
    },
    {
      id: 'user',
      name: 'Regular User',
      address: 'user_address',
      role: 'user',
      description: 'Can manage own tasks'
    },
    {
      id: 'viewer',
      name: 'Viewer User',
      address: 'viewer_address',
      role: 'viewer',
      description: 'Read-only access'
    }
  ];

  const handleLogin = async () => {
    if (!selectedUser) return;

    try {
      const userData = mockUsers.find(u => u.id === selectedUser);
      if (!userData) return;

      await login({
        id: userData.id,
        address: userData.address,
        role: userData.role as any,
        permissions: [],
        name: userData.name,
      });

      router.push('/');
    } catch (err) {
      // Error is handled by AuthContext
    }
  };

  const handleBiometricsLogin = async () => {
    try {
      const result = await authenticateDevice();
      if (result) {
        const userData = mockUsers.find(u => u.address === result.userAddress);
        if (userData) {
          await login({
            id: userData.id,
            address: userData.address,
            role: userData.role as any,
            permissions: [],
            name: userData.name,
          });
          router.push('/');
        } else {
          // Fallback if local address mapping got out of sync
          await login({
            id: 'user',
            address: result.userAddress,
            role: 'user',
            permissions: [],
            name: 'WebAuthn User',
          });
          router.push('/');
        }
      }
    } catch (err) {
      // Error is stored in useWebAuthn hook & Sentry logged
    }
  };

  const handleEnrollDevice = async () => {
    if (!selectedUser) return;
    const userData = mockUsers.find(u => u.id === selectedUser);
    if (!userData) return;

    setEnrollSuccessMessage(null);
    try {
      await enrollDevice(userData.address, userData.name);
      setEnrollSuccessMessage('Device biometrics (Secure Enclave) registered successfully!');
    } catch (err) {
      // Error is stored in useWebAuthn hook & Sentry logged
    }
  };

  const activeError = authError || webAuthnError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 px-4">
      <div className="max-w-md w-full bg-slate-800/80 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-700 p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mb-2">
            {t('login.title', { defaultValue: 'Login to SoroTask' })}
          </h1>
          <p className="text-slate-400">
            {t('login.subtitle', { defaultValue: 'Secure hardware-backed credential portal' })}
          </p>
        </div>

        {activeError && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-500/50 rounded-xl text-red-200 text-sm animate-pulse">
            {activeError}
          </div>
        )}

        {enrollSuccessMessage && (
          <div className="mb-6 p-4 bg-emerald-950/60 border border-emerald-500/50 rounded-xl text-emerald-200 text-sm">
            {enrollSuccessMessage}
          </div>
        )}

        {/* Biometrics Direct Sign In Option */}
        {isWebAuthnSupported && isBiometricsAvailable && isDeviceEnrolled && (
          <div className="mb-6">
            <button
              onClick={handleBiometricsLogin}
              disabled={isWebAuthnLoading || isAuthLoading}
              className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-500 to-blue-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-indigo-500/20 hover:from-indigo-600 hover:to-blue-700 disabled:opacity-50 transition-all transform hover:-translate-y-0.5 active:translate-y-0 duration-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11a5 5 0 00-10 0c0 1.02.166 2.001.472 2.922m8.055-4.076a10.45 10.45 0 011.884-5.185m2 10.45a9 9 0 01-11.885-3.353m12.43-1.622a12.454 12.454 0 00-1.121-7.2m0 0a12.454 12.454 0 00-9.623-4.814" />
              </svg>
              {isWebAuthnLoading ? 'Verifying biometrics...' : 'Sign in with Biometrics'}
            </button>
            <div className="relative flex py-4 items-center">
              <div className="flex-grow border-t border-slate-700"></div>
              <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase tracking-wider">or sign in with standard wallet mock</span>
              <div className="flex-grow border-t border-slate-700"></div>
            </div>
          </div>
        )}

        <div className="space-y-4 mb-6">
          {mockUsers.map((user) => (
            <label
              key={user.id}
              className={`block p-4 border rounded-xl cursor-pointer transition-all duration-200 ${
                selectedUser === user.id
                  ? 'border-blue-500 bg-blue-950/30'
                  : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="user"
                value={user.id}
                checked={selectedUser === user.id}
                onChange={(e) => {
                  setSelectedUser(e.target.value);
                  setEnrollSuccessMessage(null);
                }}
                className="sr-only"
              />
              <div className="flex items-center">
                <div className="flex-1">
                  <div className="font-semibold text-slate-200">{user.name}</div>
                  <div className="text-sm text-slate-400 mt-0.5">{user.description}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Role: {user.role} | Address: {user.address.substring(0, 12)}...
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 transition-all ${
                  selectedUser === user.id
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-slate-600'
                }`}>
                  {selectedUser === user.id && (
                    <div className="w-2.5 h-2.5 bg-slate-900 rounded-full m-0.5"></div>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleLogin}
            disabled={!selectedUser || isAuthLoading || isWebAuthnLoading}
            className="w-full bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-2.5 px-4 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isAuthLoading ? 'Signing in...' : t('login.sign_in', { defaultValue: 'Sign In (Stellar Address)' })}
          </button>

          {isWebAuthnSupported && isBiometricsAvailable && selectedUser && (
            <button
              onClick={handleEnrollDevice}
              disabled={isWebAuthnLoading || isAuthLoading}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-600 hover:border-indigo-500 hover:bg-indigo-950/20 text-slate-300 font-medium py-2 px-4 rounded-xl disabled:opacity-50 transition-all text-sm"
            >
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Register Device Biometrics for {mockUsers.find(u => u.id === selectedUser)?.name}
            </button>
          )}
        </div>

        <div className="mt-8 text-center text-xs text-slate-500">
          {t('login.demo_note', {
            defaultValue: 'SoroTask Secure Portal. Biometric actions interact directly with Apple Secure Enclave / Windows Hello hardware.'
          })}
        </div>
      </div>
    </div>
  );
}