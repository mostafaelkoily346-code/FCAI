/* Same-origin authentication, student registration, and administrator dashboard. */
(function () {
  const api = APP_CONFIG.API_BASE.replace(/\/$/, '');
  let currentUser = null;
  let currentRoute = 'home';
  const request = async (path, options = {}) => {
    const response = await fetch(`${api}${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const statusLabel = status => ({
    new: S('New', 'جديد'),
    in_progress: S('In progress', 'قيد المتابعة'),
    resolved: S('Resolved', 'تم الحل'),
    pending: S('Awaiting approval', 'بانتظار الموافقة'),
    active: S('Active', 'مفعّل'),
    blocked: S('Blocked', 'محظور')
  })[status] || status;
  const kindLabel = kind => ({
    training: S('Training application', 'طلب تدريب'),
    complaint: S('Complaint', 'شكوى'),
    suggestion: S('Suggestion', 'مقترح'),
    contact: S('Contact request', 'رسالة تواصل')
  })[kind] || kind;

  function authLink() {
    const link = document.querySelector('#auth-link');
    if (!link) return;
    if (!currentUser) {
      link.href = '#portal';
      link.textContent = S('Sign in', 'تسجيل الدخول');
    } else {
      link.href = '#logout';
      link.textContent = S('Sign out', 'تسجيل الخروج');
    }
  }

  function authForm() {
    return `<section class="pg"><div class="wrap"><div class="crumb"><a href="#home">${S('Home', 'الرئيسية')}</a> / ${S('Account', 'الحساب')}</div><h1>${S('Student portal', 'بوابة الطالب')}</h1></div></section>
      <section class="s"><div class="wrap" id="portal-box">
        <div class="tabs"><button class="tab" id="show-login">${S('Sign in', 'تسجيل الدخول')}</button><button class="tab" id="show-register">${S('Create student account', 'إنشاء حساب طالب')}</button></div>
        <form class="f" id="auth-login" style="max-width:520px">
          <label>${S('Email', 'البريد الإلكتروني')}<input name="email" type="email" autocomplete="username" maxlength="200" required></label>
          <label>${S('Password', 'كلمة المرور')}<input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn">${S('Sign in', 'تسجيل الدخول')}</button><p class="er" id="auth-error" aria-live="polite"></p>
        </form>
        <form class="f" id="auth-register" style="max-width:520px;display:none">
          <label>${S('Full name', 'الاسم الكامل')}<input name="name" maxlength="120" autocomplete="name" required></label>
          <label>${S('University email', 'البريد الجامعي')}<input name="email" type="email" maxlength="200" autocomplete="email" required></label>
          <label>${S('Student ID', 'الرقم الجامعي')}<input name="studentId" maxlength="40" required></label>
          <label>${S('Department', 'القسم')}<input name="department" maxlength="120" required></label>
          <label>${S('Password (at least 12 characters)', 'كلمة المرور (12 حرفًا على الأقل)')}<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
          <button class="btn">${S('Create account', 'إنشاء الحساب')}</button>
          <p class="note">${S('New accounts need administrator approval before sign-in.', 'الحسابات الجديدة تحتاج موافقة المدير قبل تسجيل الدخول.')}</p>
          <p class="er" id="register-error" aria-live="polite"></p>
        </form>
      </div></section>`;
  }

  function adminForm() {
    return `<section class="pg"><div class="wrap"><div class="crumb"><a href="#home">${S('Home', 'الرئيسية')}</a> / ${S('Administration', 'الإدارة')}</div><h1>${S('Admin dashboard', 'لوحة الإدارة')}</h1></div></section>
      <section class="s"><div class="wrap" id="admin-box">
        <form class="f" id="admin-login" style="max-width:520px">
          <label>${S('Admin email', 'بريد المدير')}<input name="email" type="email" autocomplete="username" required></label>
          <label>${S('Password', 'كلمة المرور')}<input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn">${S('Sign in', 'تسجيل الدخول')}</button>
          <p class="note">${S('Administrator accounts are created on the server with the admin:create command.', 'يُنشأ حساب المدير على الخادم باستخدام أمر admin:create.')}</p>
          <p class="er" id="admin-error" aria-live="polite"></p>
        </form>
      </div></section>`;
  }

  function requestCard(row, collection) {
    return `<article class="card" style="padding:18px">
      <div class="meta"><span class="tag">${esc(kindLabel(row.kind))}</span><span class="tag">${esc(statusLabel(row.status))}</span>${row.demo ? `<span class="sample">${S('Fake data', 'بيانات وهمية')}</span>` : ''}</div>
      <h3 style="margin:8px 0">${esc(row.name)} · ${esc(row.id)}</h3>
      <p>${esc(row.email)}${row.studentId ? ` · ${esc(row.studentId)}` : ''}${row.department ? ` · ${esc(row.department)}` : ''}</p>
      <p>${esc(row.message)}</p>
      <div class="meta">${esc(new Date(row.createdAt).toLocaleString(L === 'ar' ? 'ar-EG' : 'en-GB'))}</div>
      <label>${S('Update status', 'تحديث الحالة')}
        <select data-status-for="${esc(row.id)}" data-collection="${collection}">
          <option value="new" ${row.status === 'new' ? 'selected' : ''}>${S('New', 'جديد')}</option>
          <option value="in_progress" ${row.status === 'in_progress' ? 'selected' : ''}>${S('In progress', 'قيد المتابعة')}</option>
          <option value="resolved" ${row.status === 'resolved' ? 'selected' : ''}>${S('Resolved', 'تم الحل')}</option>
        </select>
      </label>
    </article>`;
  }

  function userCard(user) {
    return `<article class="card" style="padding:18px">
      <div class="meta"><span class="tag">${esc(statusLabel(user.status))}</span><span class="tag">${esc(user.role)}</span></div>
      <h3 style="margin:8px 0">${esc(user.name)} · ${esc(user.studentId)}</h3>
      <p>${esc(user.email)}${user.department ? ` · ${esc(user.department)}` : ''}</p>
      <label>${S('Account status', 'حالة الحساب')}
        <select data-account-id="${user.id}">
          <option value="pending" ${user.status === 'pending' ? 'selected' : ''}>${S('Awaiting approval', 'بانتظار الموافقة')}</option>
          <option value="active" ${user.status === 'active' ? 'selected' : ''}>${S('Active / approve', 'مفعّل / موافقة')}</option>
          <option value="blocked" ${user.status === 'blocked' ? 'selected' : ''}>${S('Blocked', 'محظور')}</option>
        </select>
      </label>
    </article>`;
  }

  function dashboard(requests, complaints, users) {
    const rows = [
      ...requests.map(row => requestCard(row, 'submissions')),
      ...complaints.map(row => requestCard(row, 'complaints'))
    ];
    const students = users.filter(user => user.role === 'student');
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <h2>${S('Requests and complaints', 'الطلبات والشكاوى')} (${rows.length})</h2>
      <div><button class="btn g sm" id="admin-refresh">${S('Refresh', 'تحديث')}</button> <button class="btn g sm" id="admin-logout">${S('Sign out', 'تسجيل الخروج')}</button></div>
    </div><p class="note">${esc(currentUser.email)} · ${S('New requests are stored in the database on this server.', 'تُحفظ الطلبات الجديدة في قاعدة بيانات هذا الخادم.')}</p>
    <h2>${S('Student accounts', 'حسابات الطلاب')} (${students.length})</h2>
    <div class="grid" style="margin-top:16px">${students.map(userCard).join('') || `<div class="empty">${S('No student accounts yet.', 'لا توجد حسابات طلاب بعد.')}</div>`}</div>
    <h2 style="margin-top:32px">${S('Requests and complaints', 'الطلبات والشكاوى')}</h2>
    <div class="grid" style="margin-top:16px">${rows.join('') || `<div class="empty">${S('No requests yet.', 'لا توجد طلبات بعد.')}</div>`}</div>
    <p class="er" id="admin-error" aria-live="polite"></p>`;
  }

  async function loadAdmin() {
    const box = document.querySelector('#admin-box');
    if (!box || currentRoute !== 'admin') return;
    box.textContent = S('Loading dashboard…', 'جارٍ تحميل لوحة الإدارة…');
    try {
      const [requests, complaints, users] = await Promise.all([
        request('/admin/submissions'),
        request('/admin/complaints'),
        request('/admin/users')
      ]);
      box.innerHTML = dashboard(requests, complaints, users);
    } catch (error) {
      currentUser = null;
      authLink();
      box.innerHTML = adminForm().match(/<form class="f" id="admin-login"[\s\S]*?<\/form>/)[0];
      document.querySelector('#admin-error').textContent = error.message;
    }
  }

  function studentHome(user) {
    return `<div class="card" style="padding:20px"><h2>${S('Welcome', 'أهلًا')} ${esc(user.name)}</h2>
      <p>${S('Your student account is active.', 'حساب الطالب مفعّل.')}</p>
      <div id="student-submissions">${S('Loading your requests…', 'جارٍ تحميل طلباتك…')}</div>
      <button class="btn g" id="student-logout">${S('Sign out', 'تسجيل الخروج')}</button></div>`;
  }

  async function loadStudentSubmissions() {
    const box = document.querySelector('#student-submissions');
    if (!box) return;
    try {
      const rows = await request('/student/submissions');
      box.innerHTML = rows.length
        ? `<ul>${rows.map(row => `<li>${esc(kindLabel(row.kind))} · ${esc(statusLabel(row.status))} · ${esc(row.id)}</li>`).join('')}</ul>`
        : `<p>${S('No requests yet.', 'لا توجد طلبات بعد.')}</p>`;
    } catch (error) {
      box.textContent = error.message;
    }
  }

  function portalPage() {
    if (currentUser?.role === 'student') {
      return `<section class="pg"><div class="wrap"><div class="crumb"><a href="#home">${S('Home', 'الرئيسية')}</a></div><h1>${S('Student portal', 'بوابة الطالب')}</h1></div></section>
        <section class="s"><div class="wrap" id="portal-box">${studentHome(currentUser)}</div></section>`;
    }
    return authForm();
  }

  V.admin = adminForm;
  V.portal = portalPage;
  const originalContact = V.contact;
  const originalServicePage = svcPage;

  function applicationForm(kind) {
    const isTraining = kind === 'training';
    const isComplaint = kind === 'complaint';
    const heading = isTraining ? S('Training application', 'التقديم على تدريب')
      : isComplaint ? S('Complaints & suggestions', 'الشكاوى والمقترحات')
        : S('Contact us', 'تواصل معنا');
    return `<section class="pg"><div class="wrap"><div class="crumb"><a href="#home">${S('Home', 'الرئيسية')}</a></div><h1>${heading}</h1></div></section>
      <section class="s"><div class="wrap two"><div>
        <p class="note">${S('Your message is stored in this project database and visible to the administrator. This is not an official university service.', 'تُحفظ رسالتك في قاعدة بيانات المشروع ويستطيع المدير الاطلاع عليها. هذه ليست خدمة جامعية رسمية.')}</p>
        <form class="f" id="application-form" data-kind="${kind}">
          <label>${S('Full name', 'الاسم الكامل')}<input name="name" maxlength="120" required></label>
          <label>${S('Email', 'البريد الإلكتروني')}<input name="email" type="email" maxlength="200" required></label>
          ${isTraining || isComplaint ? `<label>${S('Student ID (optional)', 'رقم الطالب (اختياري)')}<input name="studentId" maxlength="40"></label>` : ''}
          ${isTraining ? `<label>${S('Department', 'القسم')}<select name="department"><option value="">${S('Select', 'اختر')}</option>${DEPTS.map(d => `<option value="${esc(S(d.en, d.ar))}">${esc(S(d.en, d.ar))}</option>`).join('')}</select></label>` : ''}
          ${isComplaint ? `<label>${S('Category', 'التصنيف')}<select name="category"><option value="suggestion">${S('Suggestion', 'مقترح')}</option><option value="complaint">${S('Complaint', 'شكوى')}</option></select></label>` : ''}
          <label>${isTraining ? S('Application details', 'تفاصيل طلب التدريب') : isComplaint ? S('Description', 'الوصف') : S('Message', 'الرسالة')}<textarea name="message" rows="5" minlength="10" maxlength="2000" required></textarea></label>
          <button class="btn">${S('Submit', 'إرسال')}</button><p class="er" id="application-result" aria-live="polite"></p>
        </form>
      </div><div class="empty">${S('Avoid sending sensitive personal or confidential information.', 'تجنب إرسال معلومات شخصية حساسة أو سرية.')}</div></div></section>`;
  }

  V.contact = () => applicationForm('contact') + originalContact().replace(/<section class="pg">[\s\S]*?<\/section>/, '');
  svcPage = kind => ['training', 'complaints'].includes(kind)
    ? applicationForm(kind === 'complaints' ? 'complaint' : 'training')
    : originalServicePage(kind);

  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.id === 'admin-login' || form.id === 'auth-login') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const output = form.querySelector('#admin-error, #auth-error');
      request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.elements.email.value, password: form.elements.password.value })
      }).then(data => {
        currentUser = data.user;
        authLink();
        const destination = currentUser.role === 'admin' ? 'admin' : 'portal';
        location.hash = `#${destination}`;
        if (currentRoute === destination) route();
      }).catch(error => { output.textContent = error.message; });
      return;
    }
    if (form.id === 'auth-register') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const output = form.querySelector('#register-error');
      request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      }).then(() => {
        form.reset();
        output.textContent = S('Account created. Wait for administrator approval before signing in.', 'تم إنشاء الحساب. انتظر موافقة المدير قبل تسجيل الدخول.');
      }).catch(error => { output.textContent = error.message; });
      return;
    }
    if (form.id === 'application-form') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const output = form.querySelector('#application-result');
      const fields = Object.fromEntries(new FormData(form));
      const kind = form.dataset.kind === 'complaint' ? fields.category : form.dataset.kind;
      if (form.dataset.kind === 'complaint') fields.message = `[${kind}] ${fields.message}`;
      request(form.dataset.kind === 'complaint' ? '/complaints' : '/registrations', {
        method: 'POST',
        body: JSON.stringify({ ...fields, kind })
      }).then(data => {
        form.reset();
        output.textContent = `${S('Submitted. Tracking number:', 'تم الإرسال. رقم المتابعة:')} ${data.id}`;
      }).catch(error => { output.textContent = error.message; });
    }
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest('#show-login')) {
      document.querySelector('#auth-login').style.display = '';
      document.querySelector('#auth-register').style.display = 'none';
    }
    if (event.target.closest('#show-register')) {
      document.querySelector('#auth-login').style.display = 'none';
      document.querySelector('#auth-register').style.display = '';
    }
    if (event.target.closest('#admin-refresh')) loadAdmin();
    if (event.target.closest('#admin-logout, #student-logout, #auth-link')) {
      if (event.target.closest('#auth-link') && !currentUser) return;
      event.preventDefault();
      request('/auth/logout', { method: 'POST' }).catch(error => console.error('[auth] Sign-out failed:', error));
      currentUser = null;
      authLink();
      location.hash = '#portal';
    }
  });

  document.addEventListener('change', event => {
    const account = event.target.closest('[data-account-id]');
    const submission = event.target.closest('[data-status-for]');
    if (account) {
      request(`/admin/users/${encodeURIComponent(account.dataset.accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: account.value })
      }).then(loadAdmin).catch(showAdminError);
    } else if (submission) {
      request(`/admin/${submission.dataset.collection}/${encodeURIComponent(submission.dataset.statusFor)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: submission.value })
      }).then(loadAdmin).catch(showAdminError);
    }
  });

  function showAdminError(error) {
    const output = document.querySelector('#admin-error');
    if (output) output.textContent = error.message;
  }

  const originalRoute = route;
  route = function () {
    currentRoute = location.hash.slice(1) || 'home';
    originalRoute();
    if (currentRoute === 'admin' && currentUser?.role === 'admin') loadAdmin();
    if (currentRoute === 'portal' && currentUser?.role === 'student') loadStudentSubmissions();
  };

  const originalShell = shell;
  shell = function () {
    originalShell();
    authLink();
  };

  request('/auth/me').then(user => {
    currentUser = user;
    authLink();
    if (currentRoute === 'admin' || (currentRoute === 'portal' && user.role === 'student')) route();
  }).catch(error => {
    if (!error.message.includes('Unauthorized')) console.error('[auth] Could not restore session:', error.message);
  });
})();
