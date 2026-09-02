/*
 * Admin — the operator console for the Harith Kavish ecosystem.
 *
 * This is a static page on GitHub Pages. It holds no session, no secret and no
 * data of its own, and it could not hold a session if it wanted one: the
 * ecosystem's session cookie is `__Host-` prefixed and host-only, and the adopt
 * allow-list in the identity service exists precisely to keep the Pages sites
 * off it.
 *
 * So it asks. Every screen this file draws is an answer from
 * `auth.harithkavish.com`, which reads the visitor's own session cookie and
 * decides. Nothing here authorises anything, and in particular nothing here
 * reads `hk.user`: that cookie is scoped to `.harithkavish.com`, every
 * subdomain can write it, and a console that trusted it would be a console
 * anyone with a subdomain could open. It is display state, and this page has no
 * display to make until the server has spoken.
 */
(function () {
    'use strict';

    /*
     * Both places a session can live, asked in that order.
     *
     * The two hostnames run one deployable but they are two cookie scopes, and
     * `__Host-hk_session` is host-only by definition — so a person signed in to
     * the ecosystem holds a session on the front door, on the account host, or
     * on both, depending on which routes they happened to travel. Neither host
     * can see the other's.
     *
     * The front door is asked first because that is where a session originates.
     * But asking only the front door reports "not signed in" to someone whose
     * session is on the account host — which is a real state: the handoff at
     * `lib/auth/handoff.ts` exists precisely to put one there. One host saying
     * no is not the ecosystem saying no, so the second is asked before the
     * console believes it.
     *
     * The extra request is spent only on the way to a refusal. A visitor who is
     * signed in at the front door — the common case — costs exactly one.
     */
    var HOSTS = ['https://auth.harithkavish.com', 'https://account.harithkavish.com'];

    /** Where the session was found, so every later call goes straight there. */
    var API = HOSTS[0];

    /*
     * Signing in and out happen at the front door and nowhere else, whichever
     * host turned out to hold the session. That is the ecosystem's rule, not
     * this console's: one front door means the provider round trip has exactly
     * one redirect URI to register.
     */
    var FRONT_DOOR = HOSTS[0];

    /*
     * One bounce, then stop.
     *
     * Being sent to the front door and waved straight back is what makes this
     * feel like the rest of the ecosystem: someone already signed in never sees
     * a form. But if the return trip still finds no session, going again would
     * do the same thing forever. The breadcrumb is the same idea as the
     * identity service's own `hk_sso_attempt` cookie, and it is in
     * sessionStorage because it must not outlive the tab that set it.
     */
    var ATTEMPT_KEY = 'hk.admin.sso-attempt';

    var ISSUER_LABELS = {
        'https://accounts.google.com': 'Google',
        'accounts.google.com': 'Google',
        'https://gravatar.com': 'Gravatar'
    };

    var STATUS_PILLS = {
        active: 'pill--live',
        deletion_requested: 'pill--progress',
        deleted: 'pill--danger'
    };

    var STATUS_LABELS = {
        active: 'Active',
        deletion_requested: 'Deletion requested',
        deleted: 'Deleted'
    };

    /* ---------------------------------------------------------------------- */
    /* Small helpers                                                          */
    /* ---------------------------------------------------------------------- */

    function el(id) { return document.getElementById(id); }

    function attempted() {
        try { return sessionStorage.getItem(ATTEMPT_KEY) === '1'; }
        catch (e) { return true; } // Storage blocked — never bounce blind.
    }

    function markAttempted() {
        try { sessionStorage.setItem(ATTEMPT_KEY, '1'); } catch (e) { /* non-fatal */ }
    }

    function clearAttempt() {
        try { sessionStorage.removeItem(ATTEMPT_KEY); } catch (e) { /* non-fatal */ }
    }

    /** Show exactly one screen. */
    function show(id) {
        ['gate-checking', 'gate-signed-out', 'gate-denied', 'gate-error', 'console']
            .forEach(function (name) {
                var node = el(name);
                if (node) node.hidden = name !== id;
            });
    }

    var DATE = new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
    });

    var DATETIME = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium', timeStyle: 'short'
    });

    function formatDate(iso) {
        if (!iso) return '';
        var date = new Date(iso);
        return isNaN(date.getTime()) ? '' : DATE.format(date);
    }

    /** A text node in an element, built rather than interpolated. */
    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    /*
     * Names and addresses on this page are typed by other people. Every cell is
     * assembled from elements and `textContent`, never from a string of HTML —
     * so there is no markup for a display name to escape from in the first
     * place, rather than an escaping function that has to be remembered.
     */
    function cell(row, className) {
        return row.appendChild(make('td', className || null));
    }

    /* ---------------------------------------------------------------------- */
    /* Talking to the identity service                                        */
    /* ---------------------------------------------------------------------- */

    /*
     * `credentials: 'include'` is what carries the visitor's session cookie.
     * It works because admin and auth are different origins but the same site,
     * so a SameSite=Lax cookie still rides along — and the identity service
     * names this origin explicitly in its CORS allow-list, because with
     * credentials a wildcard is not even legal.
     */
    function request(path) {
        return fetch(API + path, {
            credentials: 'include',
            headers: { accept: 'application/json' },
            cache: 'no-store'
        });
    }

    function signInUrl() {
        return FRONT_DOOR + '/?next=' + encodeURIComponent(location.href);
    }

    /* ---------------------------------------------------------------------- */
    /* The gate                                                               */
    /* ---------------------------------------------------------------------- */

    /*
     * Ask each host in turn until one of them knows this visitor.
     *
     * A 401 is the only answer worth moving on from: it means "no session
     * here", which the next host may contradict. A 403 is a verdict about a
     * person the service has identified, and asking somewhere else would not
     * change who they are.
     *
     * A host that cannot be reached at all is skipped rather than fatal — one
     * of the two being down should not take the console with it — but if none
     * of them answered, that is reported as unreachable rather than as a
     * refusal, because "we could not ask" and "you may not" are different
     * things and only one of them is the visitor's problem.
     */
    function askHosts(index, reachedAny) {
        if (index >= HOSTS.length) {
            return reachedAny
                ? signedOut()
                : failed('The identity service could not be reached.');
        }

        API = HOSTS[index];

        return request('/api/admin/session').then(function (response) {
            if (response.status === 401) return askHosts(index + 1, true);

            return response.json().then(function (body) {
                if (response.status === 403) return denied(body.viewer);
                if (response.ok && body.owner) return admitted();
                // A shape we do not recognise is not a pass.
                return failed('The identity service gave an answer this console does not understand.');
            });
        }).catch(function () {
            return askHosts(index + 1, reachedAny);
        });
    }

    function gate() {
        show('gate-checking');
        askHosts(0, false);
    }

    function signedOut() {
        if (!attempted()) {
            // The auto sign-in: someone already signed in elsewhere in the
            // ecosystem is sent to the front door and returned here with a
            // session, having seen nothing.
            markAttempted();
            location.replace(signInUrl());
            return;
        }

        // Back from the front door, still nothing. Say so, and offer the trip
        // once more as a deliberate act rather than taking it automatically.
        el('sign-in').href = signInUrl();
        el('sign-in-note').hidden = false;
        show('gate-signed-out');
    }

    /*
     * A refusal that says what the service actually knows.
     *
     * "Access denied" with nothing beside it is only actionable if you already
     * know the rule. These three facts are the ones that decide it, and they are
     * the viewer's own account told back to them, so nothing here is a leak.
     */
    function denied(viewer) {
        clearAttempt();
        var who = viewer || {};

        el('denied-name').textContent = who.name || 'Unknown';

        // The address that would count, not merely the one on the row: an
        // unverified `users.email` is not proof, and a Google link is.
        var addresses = [];
        if (who.email && who.emailVerified) addresses.push(who.email);
        (who.providerEmails || []).forEach(function (address) {
            if (addresses.indexOf(address) === -1) addresses.push(address);
        });

        el('denied-email').textContent = addresses.length
            ? addresses.join(', ')
            : (who.email ? who.email + ' (never verified)' : 'None proved');

        var methods = (who.identities || []).map(function (issuer) {
            return ISSUER_LABELS[issuer] || issuer.replace(/^https?:\/\//, '');
        });
        el('denied-methods').textContent = methods.length ? methods.join(', ') : 'No linked provider';

        el('denied-signout').href = FRONT_DOOR + '/signout?next=' + encodeURIComponent(location.href);
        show('gate-denied');
    }

    function failed(message) {
        el('error-detail').textContent = message;
        show('gate-error');
    }

    function admitted() {
        clearAttempt();
        show('console');
        renderSurfaces();
        loadAccounts();
    }

    /* ---------------------------------------------------------------------- */
    /* Account holders                                                        */
    /* ---------------------------------------------------------------------- */

    var state = {
        accounts: [],
        filter: '',
        sortKey: 'createdAt',
        sortDirection: 'desc'
    };

    function loadAccounts() {
        var refresh = el('refresh');
        refresh.disabled = true;
        el('count').textContent = 'Loading…';

        request('/api/admin/accounts').then(function (response) {
            // A session can end while the tab is open. The console goes back
            // through the gate rather than showing a table that stopped being
            // allowed halfway through the visit.
            if (response.status === 401 || response.status === 403) return gate();

            return response.json().then(function (body) {
                if (!response.ok) {
                    el('count').textContent = body.error === 'store_unavailable'
                        ? 'The account store did not answer.'
                        : 'Could not read the account records.';
                    return;
                }
                state.accounts = body.accounts || [];
                renderSummary(body.summary);
                renderAccounts();
                el('read-at').textContent = 'Read ' + DATETIME.format(new Date(body.readAt)) + '.';
            });
        }).catch(function () {
            el('count').textContent = 'Could not reach the identity service.';
        }).then(function () {
            refresh.disabled = false;
        });
    }

    /*
     * The numbers worth having above the table.
     *
     * Every one of them is a question an operator actually asks: how many
     * people are there, how many can prove their address, how many are one bad
     * day from being locked out. A count nobody would act on is left out.
     */
    function renderSummary(summary) {
        var stats = [
            { label: 'Accounts', value: summary.total },
            { label: 'Active', value: summary.active },
            { label: 'Verified', value: summary.verified },
            { label: 'Federated', value: summary.federated },
            { label: 'With passkey', value: summary.withPasskey },
            { label: 'Signed in now', value: summary.signedIn },
            { label: 'No recovery code', value: summary.withoutRecovery, warn: summary.withoutRecovery > 0 },
            { label: 'New in 30 days', value: summary.newLast30Days }
        ];

        var host = el('summary');
        host.textContent = '';
        stats.forEach(function (stat) {
            var box = make('div', 'stat');
            var value = make('span', 'stat__value', String(stat.value));
            if (stat.warn) value.classList.add('is-warning');
            box.appendChild(value);
            box.appendChild(make('span', 'stat__label', stat.label));
            host.appendChild(box);
        });
    }

    function matches(account, needle) {
        if (!needle) return true;
        return [account.name, account.userId, account.email, account.id]
            .some(function (field) {
                return field && String(field).toLowerCase().indexOf(needle) !== -1;
            });
    }

    function compare(a, b) {
        var key = state.sortKey;
        var left = a[key];
        var right = b[key];

        // A missing identifier or address (§6.4) sorts last either way, so the
        // blanks never sit between two real values.
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;

        var result = typeof left === 'number'
            ? left - right
            : String(left).localeCompare(String(right), undefined, { sensitivity: 'base', numeric: true });

        return state.sortDirection === 'desc' ? -result : result;
    }

    function waysIn(account) {
        var ways = [];
        if (account.hasPassword) ways.push('Password');
        account.identities.forEach(function (issuer) {
            ways.push(ISSUER_LABELS[issuer] || issuer.replace(/^https?:\/\//, ''));
        });
        if (account.passkeys > 0) {
            ways.push(account.passkeys === 1 ? 'Passkey' : account.passkeys + ' passkeys');
        }
        return ways;
    }

    function buildRow(account) {
        var row = document.createElement('tr');

        var name = cell(row);
        name.appendChild(make('span', 'cell-name', account.name || 'Unnamed'));
        name.appendChild(make('span', 'cell-id', account.id));

        var identifier = cell(row);
        if (account.userId) {
            var chosen = make('span', 'cell-truncate', account.userId);
            chosen.title = account.userId;
            identifier.appendChild(chosen);
        } else {
            // Not an omission: someone who arrived through a provider is never
            // given an identifier they did not choose.
            identifier.appendChild(make('span', 'cell-none', 'Not chosen'));
        }

        var address = cell(row);
        if (account.email) {
            var mail = make('span', 'cell-truncate', account.email);
            mail.title = account.email;
            address.appendChild(mail);
            address.appendChild(document.createTextNode(' '));
            address.appendChild(account.emailVerified
                ? make('span', 'pill pill--live', 'Verified')
                : make('span', 'pill pill--progress', 'Unproved'));
        } else {
            address.appendChild(make('span', 'cell-none', 'None'));
        }

        var ways = cell(row);
        var list = make('span', 'cell-ways');
        var found = waysIn(account);
        if (found.length === 0) {
            // No password, no provider, no passkey. Worth seeing at a glance:
            // this account currently has no way in at all.
            list.appendChild(make('span', 'pill pill--danger', 'No way in'));
        } else {
            found.forEach(function (way) {
                list.appendChild(make('span', 'pill pill--neutral', way));
            });
        }
        ways.appendChild(list);

        var status = cell(row);
        status.appendChild(make(
            'span',
            'pill ' + (STATUS_PILLS[account.status] || 'pill--neutral'),
            STATUS_LABELS[account.status] || account.status
        ));

        cell(row, 'is-numeric').textContent = String(account.sessions);

        var recovery = cell(row, 'is-numeric');
        recovery.textContent = String(account.recoveryCodes);
        if (account.recoveryCodes === 0 && account.status !== 'deleted') {
            recovery.classList.add('is-warning');
            recovery.title = 'No unspent recovery code. A federated-only account with none has no way back in.';
        }

        var created = cell(row);
        created.textContent = formatDate(account.createdAt);
        created.title = account.createdAt;

        return row;
    }

    function renderAccounts() {
        var body = el('accounts').tBodies[0];
        var rows = state.accounts.filter(function (account) {
            return matches(account, state.filter);
        }).sort(compare);

        body.textContent = '';
        rows.forEach(function (account) {
            body.appendChild(buildRow(account));
        });

        el('accounts-empty').hidden = rows.length > 0 || state.accounts.length === 0;
        el('count').textContent = state.filter
            ? rows.length + ' of ' + state.accounts.length
            : state.accounts.length + (state.accounts.length === 1 ? ' account' : ' accounts');

        document.querySelectorAll('.data-table__sort').forEach(function (button) {
            if (button.dataset.sort === state.sortKey) {
                button.dataset.direction = state.sortDirection;
                button.closest('th').setAttribute(
                    'aria-sort', state.sortDirection === 'asc' ? 'ascending' : 'descending'
                );
            } else {
                delete button.dataset.direction;
                button.closest('th').removeAttribute('aria-sort');
            }
        });
    }

    /* ---------------------------------------------------------------------- */
    /* Surfaces                                                               */
    /* ---------------------------------------------------------------------- */

    /*
     * Read from the main site rather than listed here, for the reason Nexus
     * gives: a subdomain added there should appear here without an edit to this
     * repository. The status shown is the one the ecosystem publishes about
     * itself. This page does not probe the surfaces — a browser cannot read a
     * cross-origin response, so anything it claimed about their health would be
     * a guess dressed as a measurement.
     */
    function renderSurfaces() {
        var host = el('surfaces');
        // Rebuilt rather than appended to: the gate can run again mid-visit if
        // a session ends, and a second pass must not double the grid.
        host.textContent = '';
        var data = window.HarithSiteData && window.HarithSiteData.ecosystem;

        if (!Array.isArray(data) || data.length === 0) {
            el('surfaces-section').hidden = true;
            return;
        }

        var pills = { Live: 'pill--live', 'In progress': 'pill--progress', Planned: 'pill--planned' };

        data.slice().sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
        }).forEach(function (surface) {
            var card = make('article', 'card');

            var topline = make('div', 'card__topline');
            topline.appendChild(make('span', 'card__route',
                String(surface.href || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')));
            topline.appendChild(make('span', 'pill ' + (pills[surface.status] || 'pill--neutral'),
                surface.status || 'Unknown'));
            card.appendChild(topline);

            card.appendChild(make('h3', 'card__title', surface.name || surface.slug));
            if (surface.summary) card.appendChild(make('p', 'card__meta', surface.summary));

            var link = make('a', 'card__link', 'Open');
            link.href = surface.href;
            link.rel = 'noopener noreferrer';
            link.target = '_blank';
            card.appendChild(link);

            host.appendChild(card);
        });
    }

    /* ---------------------------------------------------------------------- */
    /* Wiring                                                                 */
    /* ---------------------------------------------------------------------- */

    function wire() {
        el('filter').addEventListener('input', function (event) {
            state.filter = event.target.value.trim().toLowerCase();
            renderAccounts();
        });

        el('refresh').addEventListener('click', loadAccounts);
        el('error-retry').addEventListener('click', gate);

        document.querySelectorAll('.data-table__sort').forEach(function (button) {
            button.addEventListener('click', function () {
                var key = button.dataset.sort;
                if (state.sortKey === key) {
                    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortKey = key;
                    // Dates open newest first; everything else opens A to Z.
                    state.sortDirection = key === 'createdAt' ? 'desc' : 'asc';
                }
                renderAccounts();
            });
        });

        correctShellLabel();
    }

    /*
     * The shared header renders a sign-in button labelled "Sign in to Nexus",
     * because that wording is baked into the published shell. Corrected here
     * rather than upstream: changing the distribution changes that button on
     * every surface in the ecosystem at once, and each of them would have to
     * bump its cache-busting version to see it.
     *
     * Watched rather than fixed once. The header renders itself after this
     * script runs, and renders again whenever the signed-in state changes, so a
     * single pass would land before there was anything to correct.
     */
    function correctShellLabel() {
        var header = document.querySelector('harith-header');
        if (!header) return;

        var fix = function () {
            var label = header.querySelector('.signin-button span');
            if (label && label.textContent !== 'Sign in') label.textContent = 'Sign in';
        };

        fix();
        new MutationObserver(fix).observe(header, { childList: true, subtree: true });
    }

    function start() {
        wire();
        gate();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
