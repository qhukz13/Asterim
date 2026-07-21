import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function PwaUpdater() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegistered(r: any) {
      // eslint-disable-next-line prefer-template
      console.log('SW Registered: ' + r);
    },
    onRegisterError(error: any) {
      console.log('SW registration error', error);
    }
  });

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  if (!offlineReady && !needRefresh) return null;

  return (
    <div className="pwa-toast" style={styles.toast}>
      <div style={styles.message}>
        {offlineReady ? (
          <span>App ready to work offline</span>
        ) : (
          <span>New content available, click on reload button to update.</span>
        )}
      </div>
      <div style={styles.buttons}>
        {needRefresh && (
          <button style={styles.btn} onClick={() => updateServiceWorker(true)}>
            Reload
          </button>
        )}
        <button style={styles.btnAlt} onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}

const styles = {
  toast: {
    position: 'fixed' as const,
    right: '20px',
    bottom: '20px',
    zIndex: 9999,
    padding: '12px',
    border: '1px solid #4ade80',
    borderRadius: '8px',
    backgroundColor: '#0f1115',
    color: '#e2e8f0',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    maxWidth: '300px'
  },
  message: {
    fontSize: '14px'
  },
  buttons: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end'
  },
  btn: {
    padding: '6px 12px',
    backgroundColor: '#4ade80',
    color: '#0f1115',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 'bold'
  },
  btnAlt: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: '1px solid #334155',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px'
  }
};
