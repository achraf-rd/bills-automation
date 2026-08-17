const formatMAD = (amount) => {
    return new Intl.NumberFormat('fr-MA', {
        style: 'currency',
        currency: 'MAD',
        minimumFractionDigits: 2
    }).format(amount).replace('MAD', '').trim() + ' MAD';
};

const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date);
};

const getMonthName = (date) => {
    const d = date ? new Date(date) : new Date();
    return new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(d);
};

const getCurrentBillingPeriod = () => {
    const d = new Date();
    const month = new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(d);
    const year = d.getFullYear();
    return `${month} ${year}`;
};

const daysDifference = (dateStr) => {
    if (!dateStr) return 0;
    const targetDate = new Date(dateStr);
    const now = new Date();
    const diffTime = targetDate - now;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const slugify = (text) => {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
};

module.exports = {
    formatMAD,
    formatDate,
    getMonthName,
    getCurrentBillingPeriod,
    daysDifference,
    slugify
};
