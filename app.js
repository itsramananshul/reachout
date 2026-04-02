// ════════════════════════════════════════════
// SUPABASE INIT
// ════════════════════════════════════════════
const { createClient } = supabase;
const sb = createClient(
  'https://rwxsxoavfktsinmgexfo.supabase.co',
  'sb_publishable_ogA2iSpJpZFtYt7h__dazQ_HDSWRaMT'
);

let currentUser = null;
let userProfile = {};
let userKeys = {};
let selectedJobs = new Set();
let allJobs = [];
let jobFilter = 'all';
let recruiters = {};
let campaignStep = 1;
let campaigns = [];
let selectedProvider = 'gmail';
let resumeBase64 = null;

// ════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════
async function initAuth() {
  if (window.location.hash.includes('access_token') ||
      window.location.search.includes('code=')) {
    try {
      await sb.auth.exchangeCodeForSession(window.location.href);
    } catch(e) {}
  }

  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    await loadUserData();
    if (session.provider_token && session.user.app_metadata?.provider === 'google') {
      await saveGoogleToken(session);
    }
    window.history.replaceState({}, document.title, window.location.pathname);
    showPage('page-app');
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
      currentUser = session.user;
      await loadUserData();
      if (session.provider_token && session.user.app_metadata?.provider === 'google') {
        await saveGoogleToken(session);
      }
      hideAuth();
      showPage('page-app');
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      userProfile = {}; userKeys = {}; campaigns = [];
      showPage('page-landing');
    }
  });
}

async function saveGoogleToken(session) {
  const provider = session.user.app_metadata?.provider;
  if (provider === 'google') {
    const gmailEmail = session.user.email;
    await sb.from('user_api_keys').upsert({
      user_id: session.user.id,
      gmail_email: gmailEmail,
      gmail_access_token: session.provider_token,
      gmail_refresh_token: session.provider_refresh_token || null,
      updated_at: new Date().toISOString()
    });
    userKeys.gmail_email = gmailEmail;
    userKeys.gmail_access_token = session.provider_token;
  } else if (provider === 'azure') {
    const outlookEmail = session.user.email;
    await sb.from('user_api_keys').upsert({
      user_id: session.user.id,
      outlook_email: outlookEmail,
      outlook_access_token: session.provider_token,
      outlook_refresh_token: session.provider_refresh_token || null,
      updated_at: new Date().toISOString()
    });
    userKeys.outlook_email = outlookEmail;
    userKeys.outlook_access_token = session.provider_token;
  }
}

async function connectGoogleOAuth() {
  const btn = document.getElementById('gmail-oauth-btn');
  if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: 'https://www.googleapis.com/auth/gmail.send',
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { access_type: 'offline', prompt: 'consent' }
    }
  });
  if (error) { alert('Error: ' + error.message); if (btn) { btn.textContent = 'Connect Gmail with Google'; btn.disabled = false; } }
}

async function connectOutlookOAuth() {
  const btn = document.getElementById('outlook-oauth-btn');
  if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'offline_access Mail.Send User.Read',
      redirectTo: window.location.origin + window.location.pathname,
    }
  });
  if (error) { alert('Error: ' + error.message); if (btn) { btn.textContent = 'Connect Outlook with Microsoft'; btn.disabled = false; } }
}

async function disconnectOutlook() {
  await sb.from('user_api_keys').upsert({
    user_id: currentUser.id,
    outlook_email: null, outlook_access_token: null, outlook_refresh_token: null,
    updated_at: new Date().toISOString()
  });
  userKeys.outlook_email = null; userKeys.outlook_access_token = null;
  loadApiKeyForm();
}

function selectProvider(provider) {
  selectedProvider = provider;
  const gmailBtn = document.getElementById('sel-gmail');
  const outlookBtn = document.getElementById('sel-outlook');
  const gmailStatus = document.getElementById('gmail-provider-status');
  const outlookStatus = document.getElementById('outlook-provider-status');

  if (provider === 'gmail') {
    gmailBtn?.classList.replace('btn-ghost', 'btn-outline');
    outlookBtn?.classList.replace('btn-outline', 'btn-ghost');
    gmailStatus?.classList.remove('hidden');
    outlookStatus?.classList.add('hidden');
  } else {
    outlookBtn?.classList.replace('btn-ghost', 'btn-outline');
    gmailBtn?.classList.replace('btn-outline', 'btn-ghost');
    outlookStatus?.classList.remove('hidden');
    gmailStatus?.classList.add('hidden');
  }
}

function showAuth(tab) {
  document.getElementById('auth-wrap').classList.add('show');
  switchAuthTab(tab);
}
function hideAuth() {
  document.getElementById('auth-wrap').classList.remove('show');
}
function switchAuthTab(tab) {
  document.getElementById('form-signin').classList.toggle('hidden', tab !== 'signin');
  document.getElementById('form-signup').classList.toggle('hidden', tab !== 'signup');
  document.getElementById('tab-signin').classList.toggle('on', tab === 'signin');
  document.getElementById('tab-signup').classList.toggle('on', tab === 'signup');
  document.getElementById('auth-sub-text').textContent = tab === 'signin' ? 'Sign in to your account' : 'Create your free account';
  document.getElementById('auth-err').classList.remove('show');
}

function showAuthErr(msg) {
  const el = document.getElementById('auth-err');
  el.textContent = msg;
  el.classList.add('show');
}

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: 'https://www.googleapis.com/auth/gmail.send',
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { access_type: 'offline', prompt: 'consent' }
    }
  });
  if (error) showAuthErr(error.message);
}

async function signIn() {
  const email = document.getElementById('si-email').value.trim();
  const pass = document.getElementById('si-pass').value;
  if (!email || !pass) return showAuthErr('Please fill in all fields.');
  const btn = document.getElementById('si-btn');
  btn.textContent = 'Signing in…'; btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { showAuthErr(error.message); btn.textContent = 'Sign In →'; btn.disabled = false; }
}

async function signUp() {
  const fn = document.getElementById('su-fn').value.trim();
  const ln = document.getElementById('su-ln').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const pass = document.getElementById('su-pass').value;
  if (!fn || !ln || !email || !pass) return showAuthErr('Please fill in all fields.');
  if (pass.length < 8) return showAuthErr('Password must be at least 8 characters.');
  const btn = document.getElementById('su-btn');
  btn.textContent = 'Creating account…'; btn.disabled = true;
  const { error } = await sb.auth.signUp({
    email, password: pass,
    options: { data: { full_name: `${fn} ${ln}` } }
  });
  if (error) { showAuthErr(error.message); btn.textContent = 'Create Account →'; btn.disabled = false; }
  else {
    showAuthErr('Check your email to confirm your account, then sign in!');
    document.getElementById('auth-err').style.background = 'rgba(110,231,183,.08)';
    document.getElementById('auth-err').style.color = 'var(--green)';
    btn.textContent = 'Create Account →'; btn.disabled = false;
  }
}

async function signOut() {
  await sb.auth.signOut();
}

// ════════════════════════════════════════════
// LOAD USER DATA
// ════════════════════════════════════════════
async function loadUserData() {
  if (!currentUser) return;

  const { data: prof } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (prof) userProfile = prof;

  const { data: keys } = await sb.from('user_api_keys').select('*').eq('user_id', currentUser.id).single();
  if (keys) userKeys = keys;

  const { data: camps } = await sb.from('campaigns').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (camps) campaigns = camps;

  updateSidebar();
  renderDashboard();
  loadProfileForm();
  loadApiKeyForm();
}

function updateSidebar() {
  const name = userProfile.full_name || currentUser?.email?.split('@')[0] || 'User';
  const email = currentUser?.email || '';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('sidebar-name').textContent = name;
  document.getElementById('sidebar-email').textContent = email;
  document.getElementById('nav-user-name').textContent = name;
  document.getElementById('dash-name').textContent = name.split(' ')[0];
}

// ════════════════════════════════════════════
// PAGE / SECTION NAVIGATION
// ════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function showSection(id) {
  document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'));
  document.getElementById('section-' + id).classList.remove('hidden');
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  const nav = document.getElementById('nav-' + id);
  if (nav) nav.classList.add('active');

  document.getElementById('campaign-bottom-nav').classList.toggle('hidden', id !== 'new-campaign');

  window.scrollTo(0, 0);

  if (id === 'new-campaign') { campaignStep = 1; renderCampaignStep(); loadCampaignProfileForm(); }
  if (id === 'dashboard') renderDashboard();
  if (id === 'campaigns') renderCampaignsList();
  if (id === 'profile') loadProfileForm();
  if (id === 'apikeys') loadApiKeyForm();
}

// ════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════
function renderDashboard() {
  const totalSent = campaigns.reduce((a, c) => a + (c.sent || 0), 0);
  const totalFailed = campaigns.reduce((a, c) => a + (c.failed || 0), 0);
  document.getElementById('ds-sent').textContent = totalSent;
  document.getElementById('ds-campaigns').textContent = campaigns.length;
  document.getElementById('ds-companies').textContent = totalSent;
  const rate = totalSent + totalFailed > 0 ? Math.round(totalSent / (totalSent + totalFailed) * 100) + '%' : '—';
  document.getElementById('ds-rate').textContent = rate;

  const list = document.getElementById('dash-campaigns-list');
  if (!campaigns.length) {
    list.innerHTML = '<div class="alert alert-info"><span>💡</span><span>No campaigns yet. <a style="color:var(--accent);cursor:pointer" onclick="showSection(\'new-campaign\')">Start your first →</a></span></div>';
  } else {
    list.innerHTML = campaigns.slice(0, 5).map(c => campaignCardHTML(c)).join('');
  }

  const checks = [
    { label: 'Profile completed', done: !!(userProfile.full_name && userProfile.title) },
    { label: 'Resume uploaded', done: !!userProfile.resume_url },
    { label: 'Gmail connected', done: !!userKeys.gmail_email },
    { label: 'First campaign sent', done: campaigns.some(c => c.status === 'sent') },
  ];
  document.getElementById('checklist-items').innerHTML = checks.map(c => `
    <div class="flex items-center gap-12" style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;${c.done ? 'background:rgba(110,231,183,.15);border:1px solid rgba(110,231,183,.25);color:var(--green)' : 'border:2px solid var(--border2);color:var(--muted)'}">
        ${c.done ? '✓' : ''}
      </div>
      <span style="font-size:14px;${c.done ? 'color:var(--muted2);text-decoration:line-through' : ''}">${c.label}</span>
    </div>`).join('');
}

function campaignCardHTML(c) {
  const statusClass = c.status === 'sent' ? 'sp-sent' : c.status === 'sending' ? 'sp-sending' : 'sp-draft';
  return `<div class="campaign-card">
    <div class="cc-ico">✉️</div>
    <div class="cc-info">
      <div class="cc-title">${c.name || c.search_query || 'Campaign'}</div>
      <div class="cc-meta">${c.sent || 0} sent · ${c.total_jobs || 0} jobs · ${new Date(c.created_at).toLocaleDateString()}</div>
    </div>
    <span class="status-pill ${statusClass}">${c.status || 'draft'}</span>
  </div>`;
}

function renderCampaignsList() {
  const list = document.getElementById('campaigns-list');
  if (!campaigns.length) {
    list.innerHTML = '<div class="alert alert-info"><span>💡</span><span>No campaigns yet. <a style="color:var(--accent);cursor:pointer" onclick="showSection(\'new-campaign\')">Start your first →</a></span></div>';
  } else {
    list.innerHTML = campaigns.map(c => campaignCardHTML(c)).join('');
  }
}

// ════════════════════════════════════════════
// CAMPAIGN STEP LOGIC
// ════════════════════════════════════════════
const stepLabels = ['Profile','Find Jobs','Email','Send'];
const stepHints = ['Fill in your profile','Search and select jobs','Set up your email','Review and launch'];

function renderCampaignStep() {
  for (let i = 1; i <= 4; i++) {
    document.getElementById('cs-' + i).classList.toggle('hidden', i !== campaignStep);
    const sn = document.getElementById('sn-' + i);
    sn.classList.remove('done','active');
    if (i < campaignStep) sn.classList.add('done');
    else if (i === campaignStep) sn.classList.add('active');
    if (i < 4) document.getElementById('sl-' + i).classList.toggle('done', i < campaignStep);
  }
  document.getElementById('cn-label').textContent = `Step ${campaignStep} of 4 — ${stepLabels[campaignStep-1]}`;
  document.getElementById('cn-hint').textContent = stepHints[campaignStep-1];
  document.getElementById('cn-back').classList.toggle('hidden', campaignStep === 1);
  const nextBtn = document.getElementById('cn-next');
  nextBtn.textContent = campaignStep === 3 ? 'Review →' : campaignStep === 4 ? 'Send 🚀' : 'Continue →';
  document.getElementById('campaign-bottom-nav').classList.remove('hidden');

  if (campaignStep === 2 && allJobs.length === 0) doSearch();
  if (campaignStep === 3) { resetTemplate(); refreshPreview(); loadGmailStatus(); }
  if (campaignStep === 4) buildQueue();
}

function campaignNext() {
  if (campaignStep === 2 && selectedJobs.size === 0) { alert('Select at least one job first.'); return; }
  if (campaignStep < 4) { campaignStep++; renderCampaignStep(); window.scrollTo(0, 100); }
}
function campaignBack() {
  if (campaignStep > 1) { campaignStep--; renderCampaignStep(); window.scrollTo(0, 100); }
}

function loadCampaignProfileForm() {
  setVal('cp-fn', (userProfile.full_name || '').split(' ')[0] || '');
  setVal('cp-ln', (userProfile.full_name || '').split(' ').slice(1).join(' ') || '');
  setVal('cp-title', userProfile.title || '');
  setVal('cp-bio', userProfile.bio || '');
  if (userProfile.skills?.length) {
    const wrap = document.getElementById('cp-skills');
    const inp = document.getElementById('cp-skills-input');
    userProfile.skills.forEach(s => {
      const t = document.createElement('span');
      t.className = 'tag';
      t.innerHTML = s + '<span class="tag-x" onclick="removeTag(this,\'cp-skills\')">×</span>';
      wrap.insertBefore(t, inp);
    });
  }
}

// ════════════════════════════════════════════
// JOB DATA
// ════════════════════════════════════════════
const DEMO_JOBS = [
  {id:1,title:'Software Engineer II',company:'Stripe',logo:'💳',location:'San Francisco, CA',type:'Hybrid',salary:'$160k–$210k',source:'linkedin',tags:['React','TypeScript','Node.js'],age:'2d ago',isNew:true},
  {id:2,title:'Frontend Engineer',company:'Figma',logo:'🎨',location:'Remote',type:'Remote',salary:'$140k–$185k',source:'indeed',tags:['React','CSS','WebGL'],age:'1d ago',isNew:true},
  {id:3,title:'Full Stack Engineer',company:'Notion',logo:'📝',location:'New York, NY',type:'Hybrid',salary:'$150k–$200k',source:'glassdoor',tags:['React','TypeScript','PostgreSQL'],age:'3d ago',isNew:false},
  {id:4,title:'Backend Engineer',company:'Airbnb',logo:'🏠',location:'San Francisco, CA',type:'On-site',salary:'$170k–$220k',source:'linkedin',tags:['Java','Kotlin','Kubernetes'],age:'5d ago',isNew:false},
  {id:5,title:'New Grad SWE',company:'Google',logo:'🔍',location:'Mountain View, CA',type:'On-site',salary:'$130k–$150k',source:'handshake',tags:['Python','Go','Distributed Systems'],age:'6h ago',isNew:true},
  {id:6,title:'Software Engineer',company:'Vercel',logo:'▲',location:'Remote',type:'Remote',salary:'$140k–$180k',source:'indeed',tags:['Next.js','Rust','Edge'],age:'4d ago',isNew:false},
  {id:7,title:'Product Engineer',company:'Linear',logo:'📐',location:'Remote',type:'Remote',salary:'$160k–$200k',source:'glassdoor',tags:['React','Electron','GraphQL'],age:'2d ago',isNew:true},
  {id:8,title:'SWE Intern',company:'Ramp',logo:'💰',location:'New York, NY',type:'On-site',salary:'$45/hr',source:'handshake',tags:['React','Python','SQL'],age:'6h ago',isNew:true},
];

function doSearch() {
  const container = document.getElementById('jobs-container');
  container.innerHTML = Array(4).fill('<div class="skel"></div>').join('');
  setTimeout(() => {
    allJobs = DEMO_JOBS;
    renderJobs();
  }, 1100);
}

function renderJobs() {
  const container = document.getElementById('jobs-container');
  const filtered = jobFilter === 'all' ? allJobs : allJobs.filter(j => j.source === jobFilter);
  if (!filtered.length) { container.innerHTML = '<div class="alert alert-warn"><span>🔍</span><span>No jobs from this source.</span></div>'; return; }
  container.innerHTML = filtered.map(j => `
    <div class="job-card ${selectedJobs.has(j.id) ? 'sel' : ''}" id="jc-${j.id}" onclick="toggleJob(${j.id})">
      <div class="job-logo">${j.logo}</div>
      <div class="job-info">
        <div class="job-title">${j.title}</div>
        <div class="job-co">${j.company} · ${j.location} · ${j.age}</div>
        <div class="job-tags">
          ${j.type==='Remote'?'<span class="jtag remote">Remote</span>':''}
          ${j.isNew?'<span class="jtag new_">New</span>':''}
          ${j.tags.map(t=>`<span class="jtag">${t}</span>`).join('')}
          ${j.salary?`<span class="jtag">${j.salary}</span>`:''}
        </div>
      </div>
      <div class="job-r">
        <span class="job-src">${j.source}</span>
        <div class="sel-btn">${selectedJobs.has(j.id) ? '✓' : '+'}</div>
      </div>
    </div>`).join('');

  const bar = document.getElementById('sel-bar');
  bar.classList.toggle('hidden', selectedJobs.size === 0);
  document.getElementById('sel-num').textContent = selectedJobs.size;
}

function toggleJob(id) {
  if (selectedJobs.has(id)) selectedJobs.delete(id); else selectedJobs.add(id);
  renderJobs();
}

function srcFilter(btn, src) {
  document.querySelectorAll('.src-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  jobFilter = src;
  renderJobs();
}

// ════════════════════════════════════════════
// RECRUITER FINDER
// ════════════════════════════════════════════
const REC_DB = {
  Stripe:{name:'Sarah Kim',role:'Technical Recruiter',domain:'stripe.com'},
  Figma:{name:'Marcus Chen',role:'Engineering Recruiter',domain:'figma.com'},
  Notion:{name:'Priya Patel',role:'Senior Recruiter',domain:'notion.so'},
  Airbnb:{name:'James O\'Brien',role:'University Recruiter',domain:'airbnb.com'},
  Google:{name:'Lisa Zhang',role:'Campus Recruiter',domain:'google.com'},
  Vercel:{name:'Tom Nielsen',role:'Talent Acquisition',domain:'vercel.com'},
  Linear:{name:'Anna Kowalski',role:'Recruiter',domain:'linear.app'},
  Ramp:{name:'David Park',role:'Recruiting Coordinator',domain:'ramp.com'},
};

function guessAllEmails(name, domain) {
  const clean = name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  const parts = clean.split(/\s+/);
  const f = parts[0] || 'hiring';
  const l = parts[parts.length - 1] || 'team';
  const fi = f[0];
  const li = l[0];
  return [
    `${f}@${domain}`,
    `${f}.${l}@${domain}`,
    `${fi}${l}@${domain}`,
    `${fi}.${l}@${domain}`,
    `${f}${li}@${domain}`,
    `${f}_${l}@${domain}`,
  ];
}

function findRecruiters() {
  const btn = document.getElementById('find-rec-btn');
  const container = document.getElementById('rec-results');
  const sel = [...selectedJobs];
  const jobs = allJobs.filter(j => sel.includes(j.id));

  if (!jobs.length) {
    container.innerHTML = '<div class="alert alert-warn"><span>⚠️</span><span>No jobs selected. Go back to Step 2.</span></div>';
    return;
  }

  btn.textContent = '⏳ Finding…'; btn.disabled = true;
  container.innerHTML = '';

  jobs.forEach((job, i) => {
    setTimeout(() => {
      const data = REC_DB[job.company];
      const name = data?.name || 'Hiring Team';
      const role = data?.role || 'Recruiter';
      const domain = data?.domain || `${job.company.toLowerCase().replace(/\s/g,'')}.com`;
      const emails = guessAllEmails(name, domain);

      recruiters[job.id] = {
        name, role,
        email: emails[0],
        emails,
        conf: data ? 'High' : 'Low'
      };

      const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
      const confClass = data ? 'conf-h' : 'conf-l';
      const confLabel = data ? 'High' : 'Low';

      container.innerHTML += `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 18px;margin-bottom:12px">
          <div class="rec-badge" style="background:none;border:none;padding:0;margin-bottom:12px">
            <div class="rec-av">${initials}</div>
            <div class="rec-i">
              <div class="rec-name">${name} <span style="color:var(--muted)">@ ${job.company}</span></div>
              <div class="rec-role">${role} · ${job.title}</div>
            </div>
            <span class="conf ${confClass}">${confLabel} confidence</span>
          </div>
          <div style="font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">6 email patterns — all will be tried:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${emails.map((em, idx) => `
              <span style="font-size:12px;font-family:monospace;padding:3px 10px;border-radius:100px;
                background:${idx===0?'rgba(110,231,183,.12)':'var(--surface2)'};
                border:1px solid ${idx===0?'rgba(110,231,183,.25)':'var(--border2)'};
                color:${idx===0?'var(--green)':'var(--muted2)'}">
                ${idx===0?'★ ':''}${em}
              </span>`).join('')}
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:8px">★ Primary address · others sent as CC to maximise deliverability</div>
        </div>`;

      if (i === jobs.length - 1) {
        btn.textContent = `✓ Found patterns for ${jobs.length} recruiter${jobs.length>1?'s':''}`;
        btn.disabled = false;
      }
    }, i * 400);
  });
}

// ════════════════════════════════════════════
// EMAIL TEMPLATE
// ════════════════════════════════════════════
function resetTemplate() {
  setVal('tpl-subject', 'Interested in the {{job_title}} role at {{company_name}}');
  setVal('tpl-body', `Hi {{recruiter_name}},\n\nI came across the {{job_title}} position at {{company_name}} and I'd love to be considered.\n\nI'm {{your_name}}, a {{your_title}} with hands-on experience in {{your_skills}}. I'm really drawn to {{company_name}} because of your reputation for shipping great products, and I believe my background aligns well with what you're looking for.\n\nI've attached my resume for your review. I'd love to chat — even 15 minutes would be great.\n\nBest,\n{{your_name}}`);
  refreshPreview();
}

function insVar(v) {
  const ta = document.getElementById('tpl-body');
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0,s) + v + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + v.length;
  ta.focus(); refreshPreview();
}

function refreshPreview() {
  const fn = getVal('cp-fn') || userProfile.full_name?.split(' ')[0] || 'Alex';
  const ln = getVal('cp-ln') || userProfile.full_name?.split(' ').slice(1).join(' ') || '';
  const title = getVal('cp-title') || userProfile.title || 'Software Engineer';
  const skills = getTags('cp-skills').slice(0,3).join(', ') || (userProfile.skills || ['React','Node.js']).slice(0,3).join(', ');
  const sampleJob = allJobs.find(j => selectedJobs.has(j.id)) || DEMO_JOBS[0];
  const sampleRec = recruiters[sampleJob?.id] || {name:'Sarah Kim', email:'sarah.k@stripe.com'};
  const vars = {
    '{{recruiter_name}}': sampleRec.name.split(' ')[0],
    '{{company_name}}': sampleJob?.company || 'Stripe',
    '{{job_title}}': sampleJob?.title || 'Software Engineer',
    '{{your_name}}': `${fn} ${ln}`.trim(),
    '{{your_title}}': title,
    '{{your_skills}}': skills,
  };
  const r = s => Object.entries(vars).reduce((a,[k,v]) => a.replaceAll(k,v), s);
  document.getElementById('pv-from').textContent = userKeys.gmail_email || getVal('gmail-addr-input') || 'your@gmail.com';
  document.getElementById('pv-to').textContent = sampleRec.email;
  document.getElementById('pv-subject').textContent = r(getVal('tpl-subject') || '');
  document.getElementById('pv-body').textContent = r(getVal('tpl-body') || '');
}

function loadGmailStatus() {
  const gmailConnected = !!userKeys.gmail_email;
  const outlookConnected = !!userKeys.outlook_email;

  if (!gmailConnected && outlookConnected) selectProvider('outlook');
  else selectProvider('gmail');

  document.getElementById('gmail-connected-view').classList.toggle('hidden', !gmailConnected);
  document.getElementById('gmail-not-connected-view').classList.toggle('hidden', gmailConnected);
  if (gmailConnected) document.getElementById('gmail-addr').textContent = userKeys.gmail_email;

  const outlookStep = document.getElementById('outlook-connected-view-step');
  const outlookNotStep = document.getElementById('outlook-not-connected-view');
  if (outlookStep) outlookStep.classList.toggle('hidden', !outlookConnected);
  if (outlookNotStep) outlookNotStep.classList.toggle('hidden', outlookConnected);
  if (outlookConnected) {
    const el = document.getElementById('outlook-addr-step');
    if (el) el.textContent = userKeys.outlook_email;
  }
}

// ════════════════════════════════════════════
// SEND QUEUE
// ════════════════════════════════════════════
function buildQueue() {
  const sel = [...selectedJobs];
  const jobs = allJobs.filter(j => sel.includes(j.id));
  document.getElementById('qs-total').textContent = jobs.length;
  document.getElementById('qs-found').textContent = Object.keys(recruiters).length;
  document.getElementById('qs-guess').textContent = Object.values(recruiters).filter(r => r.conf !== 'High').length;

  document.getElementById('queue-preview').innerHTML = jobs.map(j => {
    const rec = recruiters[j.id] || { name: 'Hiring Team', email: `jobs@${j.company.toLowerCase()}.com`, conf: 'Low' };
    return `<div class="queue-item">
      <div class="qs qs-wait">⏳</div>
      <div class="qi-info">
        <div class="qi-title">${j.title} @ ${j.company}</div>
        <div class="qi-meta">${j.location} · ${j.source}</div>
        <div class="qi-email">${rec.email}</div>
      </div>
      <span class="conf ${rec.conf==='High'?'conf-h':rec.conf==='Medium'?'conf-m':'conf-l'}">${rec.conf}</span>
    </div>`;
  }).join('');
}

async function startSend() {
  if (!userKeys.gmail_email) {
    alert('Please connect your Gmail first in API Keys.');
    return;
  }
  const sel = [...selectedJobs];
  const jobs = allJobs.filter(j => sel.includes(j.id));

  if (jobs.length === 0) { alert('No jobs selected.'); return; }

  document.getElementById('pre-send').classList.add('hidden');
  document.getElementById('in-send').classList.remove('hidden');
  document.getElementById('campaign-bottom-nav').classList.add('hidden');

  const lq = document.getElementById('live-queue');
  lq.innerHTML = jobs.map((j, idx) => {
    const rec = recruiters[j.id] || { email: `jobs@${j.company.toLowerCase().replace(/\s/g,'')}.com` };
    return `<div class="queue-item">
      <div class="qs qs-wait" id="lqs-${idx}">⏳</div>
      <div class="qi-info">
        <div class="qi-title">${j.title} @ ${j.company}</div>
        <div class="qi-meta" id="lqm-${idx}">Queued</div>
        <div class="qi-email">${rec.email}</div>
      </div>
    </div>`;
  }).join('');

  let sent = 0, failed = 0;

  const { data: campaign } = await sb.from('campaigns').insert({
    user_id: currentUser.id,
    name: `${getVal('job-q') || 'Software Engineer'} Campaign`,
    search_query: getVal('job-q') || 'Software Engineer',
    search_location: document.getElementById('job-loc')?.value || 'Remote',
    total_jobs: jobs.length,
    status: 'sending'
  }).select().single();

  let authToken = null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    authToken = session?.access_token;
  } catch(e) {}

  if (!authToken) {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (user) {
        const { data } = await sb.auth.refreshSession();
        authToken = data?.session?.access_token;
      }
    } catch(e) {}
  }

  if (!authToken) {
    document.getElementById('in-send').classList.add('hidden');
    document.getElementById('pre-send').classList.remove('hidden');
    document.getElementById('campaign-bottom-nav').classList.remove('hidden');
    alert('Session expired. Please sign out and sign back in with Google, then try again.');
    return;
  }

  if (!resumeBase64) {
    const stored = localStorage.getItem('reachout_resume_b64');
    const storedName = localStorage.getItem('reachout_resume_name');
    if (stored) {
      resumeBase64 = stored;
      if (storedName && !userProfile.resume_name) userProfile.resume_name = storedName;
    }
  }

  function buildEmail(job) {
    const fn = getVal('cp-fn') || userProfile.full_name?.split(' ')[0] || '';
    const ln = getVal('cp-ln') || userProfile.full_name?.split(' ').slice(1).join(' ') || '';
    const title = getVal('cp-title') || userProfile.title || '';
    const skills = getTags('cp-skills').slice(0,3).join(', ') || (userProfile.skills||[]).slice(0,3).join(', ');
    const rec = recruiters[job.id] || { name: 'Hiring Manager' };
    const vars = {
      '{{recruiter_name}}': rec.name.split(' ')[0],
      '{{company_name}}': job.company,
      '{{job_title}}': job.title,
      '{{your_name}}': `${fn} ${ln}`.trim(),
      '{{your_title}}': title,
      '{{your_skills}}': skills,
    };
    const r = s => Object.entries(vars).reduce((a,[k,v]) => a.replaceAll(k,v), s);
    return { subject: r(getVal('tpl-subject') || ''), body: r(getVal('tpl-body') || '') };
  }

  async function sendOneEmail(job) {
    const rec = recruiters[job.id] || {
      email: `recruiting@${job.company.toLowerCase().replace(/\s/g,'')}.com`,
      emails: [`recruiting@${job.company.toLowerCase().replace(/\s/g,'')}.com`],
      name: 'Hiring Manager', conf: 'Low'
    };
    const { subject, body } = buildEmail(job);
    const allEmails = rec.emails || [rec.email];

    let jobRecord = null;
    if (campaign) {
      const { data } = await sb.from('outreach_jobs').insert({
        campaign_id: campaign.id, user_id: currentUser.id,
        job_title: job.title, company: job.company,
        location: job.location, source: job.source,
        recruiter_name: rec.name, recruiter_email: allEmails.join(', '),
        recruiter_confidence: rec.conf,
        email_subject: subject, status: 'pending'
      }).select().single();
      jobRecord = data;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(
        'https://rwxsxoavfktsinmgexfo.supabase.co/functions/v1/send-email',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: allEmails[0],
            cc: allEmails.slice(1),
            subject,
            body,
            job_id: jobRecord?.id,
            provider: selectedProvider,
            resume_base64: resumeBase64,
            resume_name: userProfile.resume_name || 'resume.pdf'
          }),
          signal: controller.signal
        }
      );
    } finally { clearTimeout(timeout); }

    if (!res.ok && res.status !== 400) throw new Error(`Server error ${res.status}`);
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Send failed');
    return true;
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const qs = document.getElementById(`lqs-${i}`);
    const qm = document.getElementById(`lqm-${i}`);

    if (qs) { qs.className = 'qs qs-go'; qs.textContent = '↻'; qs.style.animation = 'spin 1.2s linear infinite'; }
    if (qm) qm.textContent = 'Sending…';

    document.getElementById('send-p').textContent = `Sending ${i+1} of ${jobs.length}…`;

    try {
      await sendOneEmail(job);
      sent++;
      if (qs) { qs.className = 'qs qs-ok'; qs.textContent = '✓'; qs.style.animation = 'none'; }
      if (qm) { qm.textContent = 'Sent ✓'; qm.style.color = 'var(--green)'; }
    } catch(err) {
      failed++;
      if (qs) { qs.className = 'qs qs-fail'; qs.textContent = '✗'; qs.style.animation = 'none'; }
      if (qm) { qm.textContent = '❌ ' + err.message; qm.style.color = 'var(--red)'; }
      console.error('Send error for', job.company, ':', err.message, err);
    }

    document.getElementById('send-p').textContent =
      `${i+1} of ${jobs.length} processed (${Math.round((i+1)/jobs.length*100)}%)`;

    if (i < jobs.length - 1) await new Promise(r => setTimeout(r, 600));
  }

  if (campaign) {
    await sb.from('campaigns').update({
      status: 'sent', sent, failed,
      sent_at: new Date().toISOString()
    }).eq('id', campaign.id);
    campaigns.unshift({ ...campaign, status: 'sent', sent, failed });
  }

  document.getElementById('in-send').classList.add('hidden');
  document.getElementById('done-view').classList.remove('hidden');
  document.getElementById('done-sent').textContent = sent;
  document.getElementById('done-fail').textContent = failed;
  document.getElementById('done-cos').textContent = new Set(jobs.map(j => j.company)).size;
  renderDashboard();
}

function resetCampaign() {
  selectedJobs.clear(); recruiters = {}; campaignStep = 1;
  document.getElementById('pre-send').classList.remove('hidden');
  document.getElementById('in-send').classList.add('hidden');
  document.getElementById('done-view').classList.add('hidden');
  document.getElementById('campaign-bottom-nav').classList.remove('hidden');
  showSection('new-campaign');
}

// ════════════════════════════════════════════
// PROFILE SAVE
// ════════════════════════════════════════════
function loadProfileForm() {
  if (!userProfile) return;
  const name = (userProfile.full_name || '').split(' ');
  setVal('pf-fn', name[0] || '');
  setVal('pf-ln', name.slice(1).join(' ') || '');
  setVal('pf-email', currentUser?.email || '');
  setVal('pf-phone', userProfile.phone || '');
  setVal('pf-title', userProfile.title || '');
  setVal('pf-linkedin', userProfile.linkedin || '');
  setVal('pf-bio', userProfile.bio || '');
  if (userProfile.exp) document.getElementById('pf-exp').value = userProfile.exp;

  const skillsWrap = document.getElementById('pf-skills');
  const skillsInput = document.getElementById('pf-skills-input');
  skillsWrap.querySelectorAll('.tag').forEach(t => t.remove());
  (userProfile.skills || []).forEach(s => {
    const t = document.createElement('span');
    t.className = 'tag';
    t.innerHTML = s + '<span class="tag-x" onclick="removeTag(this,\'pf-skills\')">×</span>';
    skillsWrap.insertBefore(t, skillsInput);
  });

  const storedResumeName = localStorage.getItem('reachout_resume_name');
  if (storedResumeName) {
    document.getElementById('pf-resume-name-show').textContent = storedResumeName;
    document.getElementById('pf-resume-existing').classList.remove('hidden');
  } else if (userProfile.resume_name) {
    document.getElementById('pf-resume-name-show').textContent = userProfile.resume_name;
    document.getElementById('pf-resume-existing').classList.remove('hidden');
  }
}

async function saveProfile() {
  const fn = getVal('pf-fn'), ln = getVal('pf-ln');
  const updates = {
    full_name: `${fn} ${ln}`.trim(),
    phone: getVal('pf-phone'),
    title: getVal('pf-title'),
    linkedin: getVal('pf-linkedin'),
    bio: getVal('pf-bio'),
    experience: document.getElementById('pf-exp').value,
    skills: getTags('pf-skills'),
    updated_at: new Date().toISOString()
  };

  const resumeInput = document.getElementById('pf-resume-drop').querySelector('input');
  if (resumeInput.files[0]) {
    const file = resumeInput.files[0];
    if (file.size > 4 * 1024 * 1024) {
      alert('Resume must be under 4MB for browser storage.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(',')[1];
      try {
        localStorage.setItem('reachout_resume_b64', base64);
        localStorage.setItem('reachout_resume_name', file.name);
        resumeBase64 = base64;
      } catch(err) {
        alert('Browser storage full — try a smaller resume file.');
      }
    };
    reader.readAsDataURL(file);
    updates.resume_name = file.name;
    updates.resume_url = null;
  }

  const { error } = await sb.from('profiles').upsert({ id: currentUser.id, ...updates });
  if (!error) {
    userProfile = { ...userProfile, ...updates };
    updateSidebar();
    alert('Profile saved!');
  } else { alert('Error saving: ' + error.message); }
}

async function removeResume() {
  localStorage.removeItem('reachout_resume_b64');
  localStorage.removeItem('reachout_resume_name');
  resumeBase64 = null;
  await sb.from('profiles').update({ resume_url: null, resume_name: null }).eq('id', currentUser.id);
  userProfile.resume_url = null; userProfile.resume_name = null;
  document.getElementById('pf-resume-existing').classList.add('hidden');
}

// ════════════════════════════════════════════
// API KEYS
// ════════════════════════════════════════════
function loadApiKeyForm() {
  const gmailConnected = !!userKeys.gmail_email;
  document.getElementById('gmail-not-connected').classList.toggle('hidden', gmailConnected);
  document.getElementById('gmail-connected-view').classList.toggle('hidden', !gmailConnected);
  if (gmailConnected) {
    document.getElementById('gmail-email-show').textContent = userKeys.gmail_email;
    const badge = document.getElementById('gmail-status-badge');
    if (badge) { badge.style.display = 'inline-flex'; document.getElementById('gmail-status-text').textContent = 'Connected — ' + userKeys.gmail_email; }
  }

  const outlookConnected = !!userKeys.outlook_email;
  const outlookNotConn = document.getElementById('outlook-not-connected');
  const outlookConn = document.getElementById('outlook-connected-view');
  if (outlookNotConn) outlookNotConn.classList.toggle('hidden', outlookConnected);
  if (outlookConn) outlookConn.classList.toggle('hidden', !outlookConnected);
  if (outlookConnected) {
    const el = document.getElementById('outlook-email-show');
    if (el) el.textContent = userKeys.outlook_email;
    const badge = document.getElementById('outlook-status-badge');
    if (badge) { badge.style.display = 'inline-flex'; document.getElementById('outlook-status-text').textContent = 'Connected — ' + userKeys.outlook_email; }
  }

  if (userKeys.hunter_api_key) document.getElementById('hunter-badge').style.display = 'inline-flex';
  if (userKeys.rapidapi_key) document.getElementById('rapid-badge').style.display = 'inline-flex';
}

async function disconnectGmail() {
  await sb.from('user_api_keys').upsert({ user_id: currentUser.id, gmail_email: null, gmail_access_token: null, gmail_refresh_token: null, updated_at: new Date().toISOString() });
  userKeys.gmail_email = null; userKeys.gmail_access_token = null;
  loadApiKeyForm();
}

async function saveGmailAddr() { /* legacy fallback */ }

async function saveApiKey(type) {
  const keyMap = { hunter: 'hunter-key', rapidapi: 'rapid-key' };
  const dbMap = { hunter: 'hunter_api_key', rapidapi: 'rapidapi_key' };
  const badgeMap = { hunter: 'hunter-badge', rapidapi: 'rapid-badge' };
  const val = getVal(keyMap[type]).trim();
  if (!val) return;
  const { error } = await sb.from('user_api_keys').upsert({ user_id: currentUser.id, [dbMap[type]]: val, updated_at: new Date().toISOString() });
  if (!error) {
    userKeys[dbMap[type]] = val;
    document.getElementById(badgeMap[type]).style.display = 'inline-flex';
    alert(`${type === 'hunter' ? 'Hunter.io' : 'RapidAPI'} key saved!`);
  }
}

// ════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════
function getVal(id) { return document.getElementById(id)?.value || ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function getTags(id) { return [...document.querySelectorAll('#' + id + ' .tag')].map(t => t.textContent.replace('×','').trim()); }
function removeTag(el, id) { el.closest('.tag').remove(); }
function handleTag(e, wrapId, inputId) {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const input = document.getElementById(inputId);
  const val = input.value.trim().replace(/,$/, '');
  if (!val) return;
  const wrap = document.getElementById(wrapId);
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.innerHTML = val + `<span class="tag-x" onclick="removeTag(this,'${wrapId}')">×</span>`;
  wrap.insertBefore(tag, input);
  input.value = '';
}
function handleFile(input, dropId, infoId, nameId) {
  const f = input.files[0]; if (!f) return;
  document.getElementById(nameId).textContent = f.name;
  document.getElementById(infoId).classList.add('show');
  document.getElementById(dropId).style.display = 'none';
}
function clearFile(dropId, infoId) {
  document.getElementById(infoId).classList.remove('show');
  document.getElementById(dropId).style.display = 'block';
  document.getElementById(dropId).querySelector('input').value = '';
}

// ════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  resetTemplate();
  document.getElementById('si-pass').addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });
  document.getElementById('su-pass').addEventListener('keydown', e => { if (e.key === 'Enter') signUp(); });
});
