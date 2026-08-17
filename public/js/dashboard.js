const toastContainer = document.getElementById('toast-container');
const loadingOverlay = document.getElementById('loading-overlay');
let currentModalCallback = null;

function showToast(message, type = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function showLoading(message = 'Loading...') {
  if (!loadingOverlay) return;
  const msgEl = loadingOverlay.querySelector('.loading-msg');
  if (msgEl) msgEl.textContent = message;
  loadingOverlay.style.display = 'flex';
}

function hideLoading() {
  if (!loadingOverlay) return;
  loadingOverlay.style.display = 'none';
}

async function apiCall(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (error) {
    showToast(`Erreur: ${error.message}`, 'error');
    throw error;
  }
}

async function checkAllBills() {
  showLoading('Checking all bills...');
  try {
    await apiCall('/api/check-now', { method: 'POST' });
    showToast('Verification completed successfully', 'success');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    hideLoading();
  }
}

async function checkProvider(provider) {
  showLoading(`Checking ${provider}...`);
  try {
    const res = await apiCall(`/api/check-provider/${provider}`, { method: 'POST' });
    showToast(`${provider} verification completed`, 'success');
    hideLoading();
    
    // Check if auto CMI toggle is ON for this provider
    const toggle = document.getElementById(`toggle-cmi-${provider}`);
    const cardType = provider.toLowerCase() === 'inwi' ? 'internet' : 'water';
    
    if (toggle && toggle.checked) {
      // Launch SSE stream automatically under the card!
      startCmiSseStream(provider, cardType, '');
    } else {
      setTimeout(() => window.location.reload(), 800);
    }
  } catch (err) {
    hideLoading();
  }
}

async function sendEmail() {
  showLoading('Sending email...');
  try {
    await apiCall('/api/send-email', { method: 'POST' });
    showToast('Email sent successfully', 'success');
    hideLoading();
  } catch (err) {
    hideLoading();
  }
}

function confirmMarkPaid(billId) {
  const modal = document.getElementById('confirm-modal');
  if (modal) {
    modal.style.display = 'flex';
    currentModalCallback = () => markPaid(billId);
  }
}

function closeModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.style.display = 'none';
  currentModalCallback = null;
}

function confirmModalAction() {
  if (currentModalCallback) currentModalCallback();
  closeModal();
}

async function markPaid(billId) {
  showLoading('Updating status...');
  try {
    await apiCall(`/api/mark-paid/${billId}`, { method: 'POST' });
    showToast('Bill marked as paid', 'success');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    hideLoading();
  }
}

async function saveInlineSetting(key, value) {
  try {
    const payload = {};
    payload[key] = value;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload)
    });
    showToast('Identifier saved', 'success');
  } catch (err) {
    console.error('Failed to save inline setting:', err);
  }
}

async function saveAndCheck(provider, inputIds) {
  const ids = Array.isArray(inputIds) ? inputIds : [inputIds];
  let payload = {};
  for (const id of ids) {
    const input = document.getElementById(`config-${id}`);
    if (input && input.value) {
      payload[id] = input.value;
    }
  }
  
  if (Object.keys(payload).length > 0) {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(payload)
      });
      showToast('Settings saved', 'success');
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }
  
  await checkProvider(provider);
}

async function payBill(billId, paymentUrl, provider, cardType = 'internet') {
  // If we already have a direct CMI link, open it immediately
  if (paymentUrl && paymentUrl.includes('cmi.co.ma')) {
    window.open(paymentUrl, '_blank');
    return;
  }

  if (provider.toLowerCase() === 'inwi') {
    startCmiSseStream(provider, cardType, paymentUrl);
  } else {
    window.open(paymentUrl || 'https://client.lydec.ma/client/payer-facture', '_blank');
  }
}

function startCmiSseStream(provider, cardType, fallbackUrl) {
  const logBox = document.getElementById(`cmi-log-box-${cardType}`);
  const logContent = document.getElementById(`cmi-log-content-${cardType}`);
  const payBtn = document.getElementById(`pay-btn-${cardType}`);
  
  if (logBox) logBox.style.display = 'block';
  if (logContent) logContent.innerHTML = '<div style="color:#06b6d4;">⏳ Connecting to live SSE events...</div>';
  if (payBtn) payBtn.disabled = true;

  const eventSource = new EventSource(`/api/stream-cmi/${provider}`);

  eventSource.onmessage = function(event) {
    try {
      const data = JSON.parse(event.data);
      
      if (data.log && logContent) {
        const line = document.createElement('div');
        line.style.margin = '2px 0';
        line.textContent = data.log;
        logContent.appendChild(line);
        logBox.scrollTop = logBox.scrollHeight;
      }

      if (data.complete) {
        eventSource.close();
        if (payBtn) payBtn.disabled = false;
        
        if (data.url && data.url.includes('cmi.co.ma')) {
          const successMsg = document.createElement('div');
          successMsg.style.color = '#22c55e';
          successMsg.style.fontWeight = 'bold';
          successMsg.textContent = '🚀 Direct CMI link generated successfully!';
          logContent.appendChild(successMsg);
          
          const cmiBtn = document.getElementById(`cmi-link-btn-${cardType}`);
          if (cmiBtn) {
            cmiBtn.href = data.url;
            cmiBtn.style.display = 'inline-flex';
          }
        } else {
          const errorMsg = document.createElement('div');
          errorMsg.style.color = '#ef4444';
          errorMsg.textContent = '⚠️ Failed to generate CMI link. Please use the standard link.';
          logContent.appendChild(errorMsg);
        }
      }
    } catch (err) {
      console.error('SSE Error:', err);
    }
  };

  eventSource.onerror = function(err) {
    console.error('SSE Connection Error:', err);
    eventSource.close();
    if (payBtn) payBtn.disabled = false;
    window.open(fallbackUrl || 'https://inwi.ma/fr/paiement-facture/paiement', '_blank');
  };
}

function togglePassword(btn) {
  const input = btn.previousElementSibling;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'r') {
    e.preventDefault();
    checkAllBills();
  }
});
