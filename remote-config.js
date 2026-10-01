/**
 * Lampa Remote Config
 * Удалённая настройка Lampa (плагины) между устройствами по коду.
 * Работает из любой сети через PeerJS (P2P).
 *
 * Установка: Настройки → Расширения → Добавить плагин
 * URL: https://ВАШ_ЮЗЕР.github.io/lampa-remote/remote-config.js
 *
 * Использование:
 * 1. На ТВ: Настройки → Remote Config → «Стать хостом» → показать код
 * 2. На ПК: Настройки → Remote Config → «Подключиться» → ввести код
 * 3. Управлять плагинами ТВ с ПК
 */

(function () {
    'use strict';

    if (window.lampa_remote_config_ready) return;
    window.lampa_remote_config_ready = true;

    var PLUGIN_NAME = 'remote_config';
    var PEER_PREFIX = 'lr'; // префикс peer-id
    var peerjsLoaded = false;
    var currentPeer = null;
    var currentConn = null;
    var isHost = false;
    var hostCode = null;
    var statusText = 'Не подключено';

    // ─── Утилиты ───────────────────────────────────────────────────────────

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[RemoteConfig]');
        console.log.apply(console, args);
    }

    function noty(msg, type) {
        if (Lampa.Noty) Lampa.Noty.show(msg, { time: 3500, style: type || 'default' });
    }

    function generateCode() {
        // 6 цифр
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    function loadPeerJS(callback) {
        if (window.Peer) {
            peerjsLoaded = true;
            callback();
            return;
        }
        if (peerjsLoaded) {
            // уже грузим
            var check = setInterval(function () {
                if (window.Peer) {
                    clearInterval(check);
                    callback();
                }
            }, 100);
            return;
        }
        peerjsLoaded = true;
        var script = document.createElement('script');
        script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
        script.onload = function () {
            log('PeerJS loaded');
            callback();
        };
        script.onerror = function () {
            peerjsLoaded = false;
            noty('Не удалось загрузить PeerJS', 'error');
        };
        document.head.appendChild(script);
    }

    function destroyPeer() {
        try {
            if (currentConn) {
                currentConn.close();
                currentConn = null;
            }
            if (currentPeer) {
                currentPeer.destroy();
                currentPeer = null;
            }
        } catch (e) {}
        isHost = false;
        hostCode = null;
        statusText = 'Не подключено';
        updateStatusUI();
    }

    // ─── Команды ───────────────────────────────────────────────────────────

    function getPluginsList() {
        // Локальные плагины + CUB (если есть)
        var local = Lampa.Storage.get('plugins', '[]') || [];
        if (typeof local === 'string') {
            try { local = JSON.parse(local); } catch (e) { local = []; }
        }
        return local.map(function (p, idx) {
            return {
                index: idx,
                name: p.name || p.url || 'Без имени',
                url: p.url || '',
                status: p.status !== undefined ? p.status : 1,
                author: p.author || ''
            };
        });
    }

    function applyPluginsList(list) {
        // list — массив объектов {name, url, status, author}
        var cleaned = list.map(function (p) {
            return {
                name: p.name || '',
                url: p.url || '',
                status: p.status !== undefined ? Number(p.status) : 1,
                author: p.author || ''
            };
        });
        Lampa.Storage.set('plugins', cleaned);
        noty('Список плагинов обновлён. Перезагрузите приложение.', 'success');
    }

    function handleCommand(data) {
        if (!data || !data.cmd) return;

        log('CMD', data.cmd, data);

        switch (data.cmd) {
            case 'ping':
                send({ cmd: 'pong', time: Date.now() });
                break;

            case 'get_plugins':
                send({
                    cmd: 'plugins_list',
                    plugins: getPluginsList(),
                    device: {
                        platform: Lampa.Platform ? Lampa.Platform.get() : 'unknown',
                        version: Lampa.Manifest ? Lampa.Manifest.app_version : '?'
                    }
                });
                break;

            case 'set_plugins':
                if (Array.isArray(data.plugins)) {
                    applyPluginsList(data.plugins);
                    send({ cmd: 'ok', action: 'set_plugins' });
                }
                break;

            case 'add_plugin':
                if (data.url) {
                    var plugins = Lampa.Storage.get('plugins', '[]') || [];
                    if (typeof plugins === 'string') {
                        try { plugins = JSON.parse(plugins); } catch (e) { plugins = []; }
                    }
                    // уже есть?
                    var exists = plugins.some(function (p) { return p.url === data.url; });
                    if (!exists) {
                        plugins.push({
                            name: data.name || data.url,
                            url: data.url,
                            status: 1,
                            author: data.author || 'remote'
                        });
                        Lampa.Storage.set('plugins', plugins);
                        noty('Плагин добавлен: ' + (data.name || data.url), 'success');
                    }
                    send({ cmd: 'plugins_list', plugins: getPluginsList() });
                }
                break;

            case 'toggle_plugin':
                if (typeof data.index === 'number') {
                    var plugs = Lampa.Storage.get('plugins', '[]') || [];
                    if (typeof plugs === 'string') {
                        try { plugs = JSON.parse(plugs); } catch (e) { plugs = []; }
                    }
                    if (plugs[data.index]) {
                        plugs[data.index].status = plugs[data.index].status ? 0 : 1;
                        Lampa.Storage.set('plugins', plugs);
                        noty('Статус плагина изменён', 'success');
                    }
                    send({ cmd: 'plugins_list', plugins: getPluginsList() });
                }
                break;

            case 'remove_plugin':
                if (typeof data.index === 'number') {
                    var pl = Lampa.Storage.get('plugins', '[]') || [];
                    if (typeof pl === 'string') {
                        try { pl = JSON.parse(pl); } catch (e) { pl = []; }
                    }
                    if (pl[data.index]) {
                        var removed = pl.splice(data.index, 1)[0];
                        Lampa.Storage.set('plugins', pl);
                        noty('Удалён: ' + (removed.name || removed.url), 'success');
                    }
                    send({ cmd: 'plugins_list', plugins: getPluginsList() });
                }
                break;

            case 'reload':
                noty('Перезагрузка по команде с ПК...', 'info');
                setTimeout(function () {
                    window.location.reload();
                }, 800);
                break;

            case 'get_info':
                send({
                    cmd: 'info',
                    platform: Lampa.Platform ? Lampa.Platform.get() : 'unknown',
                    version: Lampa.Manifest ? Lampa.Manifest.app_version : '?',
                    plugins_count: getPluginsList().length
                });
                break;

            default:
                log('Unknown cmd', data.cmd);
        }
    }

    function send(obj) {
        if (currentConn && currentConn.open) {
            try {
                currentConn.send(obj);
            } catch (e) {
                log('send error', e);
            }
        }
    }

    // ─── Peer ──────────────────────────────────────────────────────────────

    function startHost() {
        destroyPeer();
        loadPeerJS(function () {
            var code = generateCode();
            hostCode = code;
            var peerId = PEER_PREFIX + code;

            currentPeer = new Peer(peerId, {
                debug: 1
            });

            currentPeer.on('open', function (id) {
                isHost = true;
                statusText = 'Хост готов. Код: ' + code;
                updateStatusUI();
                noty('Код для подключения: ' + code, 'success');
                log('Host open', id);
            });

            currentPeer.on('connection', function (conn) {
                log('Incoming connection');
                currentConn = conn;
                setupConnection(conn);
                statusText = 'Подключён контроллер';
                updateStatusUI();
                noty('ПК подключился!', 'success');
            });

            currentPeer.on('error', function (err) {
                log('Peer error', err);
                if (err.type === 'unavailable-id') {
                    // код занят — пробуем новый
                    startHost();
                } else {
                    noty('Ошибка PeerJS: ' + (err.type || err.message), 'error');
                    destroyPeer();
                }
            });

            currentPeer.on('disconnected', function () {
                statusText = 'Отключён от сигнального сервера';
                updateStatusUI();
            });
        });
    }

    function startClient(code) {
        if (!code || code.length < 4) {
            noty('Введите корректный код', 'error');
            return;
        }
        destroyPeer();
        loadPeerJS(function () {
            var peerId = PEER_PREFIX + code.trim();

            currentPeer = new Peer(undefined, { debug: 1 }); // случайный id для клиента

            currentPeer.on('open', function () {
                log('Client peer open, connecting to', peerId);
                statusText = 'Подключаюсь...';
                updateStatusUI();

                var conn = currentPeer.connect(peerId, { reliable: true });
                currentConn = conn;
                setupConnection(conn);
            });

            currentPeer.on('error', function (err) {
                log('Client error', err);
                noty('Ошибка подключения: ' + (err.type || err.message), 'error');
                destroyPeer();
            });
        });
    }

    function setupConnection(conn) {
        conn.on('open', function () {
            log('Data channel open');
            statusText = isHost ? 'Контроллер подключён' : 'Подключено к ТВ';
            updateStatusUI();
            noty(isHost ? 'Контроллер подключён' : 'Успешно подключено к ТВ', 'success');

            if (!isHost) {
                // клиент сразу запрашивает список
                send({ cmd: 'get_plugins' });
            }
        });

        conn.on('data', function (data) {
            if (isHost) {
                handleCommand(data);
            } else {
                // ответы для клиента
                handleClientData(data);
            }
        });

        conn.on('close', function () {
            log('Connection closed');
            statusText = 'Соединение закрыто';
            updateStatusUI();
            currentConn = null;
            noty('Соединение разорвано', 'error');
        });

        conn.on('error', function (err) {
            log('Conn error', err);
        });
    }

    // Данные, приходящие на ПК (клиент)
    var lastPlugins = [];
    var remoteDevice = {};

    function handleClientData(data) {
        if (!data || !data.cmd) return;

        switch (data.cmd) {
            case 'plugins_list':
                lastPlugins = data.plugins || [];
                remoteDevice = data.device || {};
                showControlScreen();
                break;
            case 'info':
                remoteDevice = data;
                noty('ТВ: ' + (data.platform || '?') + ' v' + (data.version || '?'), 'info');
                break;
            case 'ok':
                noty('Команда выполнена', 'success');
                break;
            case 'pong':
                log('pong', data.time);
                break;
        }
    }

    // ─── UI ────────────────────────────────────────────────────────────────

    function updateStatusUI() {
        // если открыт экран настроек — обновим
        var el = document.querySelector('.remote-config-status');
        if (el) el.textContent = statusText;
    }

    function showControlScreen() {
        // Экран управления (только на ПК после подключения)
        var html = $('<div class="remote-control-screen" style="padding:1.5em;max-width:900px;margin:0 auto;"></div>');

        html.append('<div style="margin-bottom:1.2em;font-size:1.3em;opacity:0.8;">Статус: <b class="remote-config-status">' + statusText + '</b></div>');

        if (remoteDevice.platform) {
            html.append('<div style="margin-bottom:1em;opacity:0.7;">Устройство: ' + remoteDevice.platform + ' · Lampa ' + (remoteDevice.version || '') + '</div>');
        }

        // Список плагинов
        var list = $('<div class="remote-plugins-list" style="margin:1.5em 0;"></div>');
        list.append('<div style="font-size:1.2em;margin-bottom:0.8em;font-weight:600;">Плагины на ТВ (' + lastPlugins.length + ')</div>');

        if (lastPlugins.length === 0) {
            list.append('<div style="opacity:0.6;">Список пуст</div>');
        } else {
            lastPlugins.forEach(function (p, i) {
                var row = $('<div class="selector" style="display:flex;align-items:center;padding:0.7em 0.5em;border-bottom:1px solid rgba(255,255,255,0.08);gap:1em;"></div>');
                var statusBadge = p.status ? '<span style="color:#4caf50;">ON</span>' : '<span style="color:#f44336;">OFF</span>';
                row.append('<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                    statusBadge + '  ' + (p.name || p.url) +
                    '<div style="font-size:0.85em;opacity:0.55;overflow:hidden;text-overflow:ellipsis;">' + p.url + '</div></div>');

                var btnToggle = $('<div class="simple-button selector" style="padding:0.4em 0.8em;white-space:nowrap;">' + (p.status ? 'Выкл' : 'Вкл') + '</div>');
                btnToggle.on('hover:enter', function () {
                    send({ cmd: 'toggle_plugin', index: i });
                });

                var btnRemove = $('<div class="simple-button selector" style="padding:0.4em 0.8em;color:#f44336;">Удалить</div>');
                btnRemove.on('hover:enter', function () {
                    Lampa.Modal.open({
                        title: 'Удалить плагин?',
                        html: '<div style="padding:1em;">' + (p.name || p.url) + '</div>',
                        buttons: [
                            {
                                title: 'Удалить',
                                onSelect: function () {
                                    Lampa.Modal.close();
                                    send({ cmd: 'remove_plugin', index: i });
                                }
                            },
                            {
                                title: 'Отмена',
                                onSelect: function () { Lampa.Modal.close(); }
                            }
                        ]
                    });
                });

                row.append(btnToggle).append(btnRemove);
                list.append(row);
            });
        }
        html.append(list);

        // Добавить плагин
        var addBlock = $('<div style="margin-top:2em;"></div>');
        addBlock.append('<div style="font-size:1.15em;margin-bottom:0.6em;">Добавить плагин по URL</div>');
        var input = $('<input type="text" class="simple-input selector" placeholder="https://.../plugin.js" style="width:100%;padding:0.7em;margin-bottom:0.8em;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:0.4em;color:inherit;font-size:1em;">');
        var btnAdd = $('<div class="simple-button selector" style="display:inline-block;padding:0.6em 1.4em;">Добавить на ТВ</div>');
        btnAdd.on('hover:enter', function () {
            var url = (input.val() || '').trim();
            if (!url) {
                noty('Введите URL', 'error');
                return;
            }
            send({ cmd: 'add_plugin', url: url, name: url.split('/').pop() });
            input.val('');
        });
        addBlock.append(input).append(btnAdd);
        html.append(addBlock);

        // Кнопки действий
        var actions = $('<div style="margin-top:2.5em;display:flex;gap:1em;flex-wrap:wrap;"></div>');

        var btnReload = $('<div class="simple-button selector" style="padding:0.7em 1.5em;background:rgba(255,152,0,0.2);">Перезагрузить ТВ</div>');
        btnReload.on('hover:enter', function () {
            Lampa.Modal.open({
                title: 'Перезагрузить Lampa на ТВ?',
                html: '<div style="padding:1em;">Приложение на телевизоре будет перезапущено.</div>',
                buttons: [
                    {
                        title: 'Перезагрузить',
                        onSelect: function () {
                            Lampa.Modal.close();
                            send({ cmd: 'reload' });
                        }
                    },
                    {
                        title: 'Отмена',
                        onSelect: function () { Lampa.Modal.close(); }
                    }
                ]
            });
        });

        var btnRefresh = $('<div class="simple-button selector" style="padding:0.7em 1.5em;">Обновить список</div>');
        btnRefresh.on('hover:enter', function () {
            send({ cmd: 'get_plugins' });
            noty('Запрос отправлен...', 'info');
        });

        var btnDisconnect = $('<div class="simple-button selector" style="padding:0.7em 1.5em;color:#f44336;">Отключиться</div>');
        btnDisconnect.on('hover:enter', function () {
            destroyPeer();
            Lampa.Activity.back();
        });

        actions.append(btnReload).append(btnRefresh).append(btnDisconnect);
        html.append(actions);

        // Показываем как Activity
        Lampa.Activity.push({
            url: '',
            title: 'Управление ТВ',
            component: 'remote_control_panel',
            page: 1
        });

        // Регистрируем временный компонент
        Lampa.Component.add('remote_control_panel', function (object) {
            this.create = function () {
                return this.render();
            };
            this.render = function () {
                return html;
            };
            this.start = function () {
                Lampa.Controller.add('content', {
                    toggle: function () {
                        Lampa.Controller.collectionSet(html);
                        Lampa.Controller.collectionFocus(false, html);
                    },
                    left: function () {
                        if (Navigator.canmove('left')) Navigator.move('left');
                        else Lampa.Controller.toggle('menu');
                    },
                    right: function () {
                        Navigator.move('right');
                    },
                    up: function () {
                        if (Navigator.canmove('up')) Navigator.move('up');
                        else Lampa.Controller.toggle('head');
                    },
                    down: function () {
                        if (Navigator.canmove('down')) Navigator.move('down');
                    },
                    back: function () {
                        Lampa.Activity.back();
                    }
                });
                Lampa.Controller.toggle('content');
            };
            this.pause = function () {};
            this.stop = function () {};
            this.destroy = function () {
                html.remove();
            };
        });
    }

    // ─── Settings ──────────────────────────────────────────────────────────

    function initSettings() {
        Lampa.Lang.add({
            remote_config_title: {
                ru: 'Remote Config',
                en: 'Remote Config',
                uk: 'Remote Config'
            },
            remote_config_host: {
                ru: 'Стать хостом (ТВ)',
                en: 'Become host (TV)',
                uk: 'Стати хостом (ТВ)'
            },
            remote_config_connect: {
                ru: 'Подключиться по коду (ПК)',
                en: 'Connect by code (PC)',
                uk: 'Підключитися за кодом (ПК)'
            },
            remote_config_status: {
                ru: 'Статус',
                en: 'Status',
                uk: 'Статус'
            },
            remote_config_disconnect: {
                ru: 'Отключиться',
                en: 'Disconnect',
                uk: 'Відключитися'
            },
            remote_config_about: {
                ru: 'О плагине',
                en: 'About',
                uk: 'Про плагін'
            }
        });

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_NAME,
            name: Lampa.Lang.translate('remote_config_title'),
            icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>'
        });

        // Статус (показывается в описании)
        Lampa.SettingsApi.addParam({
            component: PLUGIN_NAME,
            param: {
                name: 'remote_config_status_display',
                type: 'trigger',
                default: false
            },
            field: {
                name: Lampa.Lang.translate('remote_config_status'),
                description: statusText
            },
            onRender: function (item) {
                var descr = item.find('.settings-param__descr');
                if (descr.length) {
                    descr.addClass('remote-config-status').text(statusText);
                }
            },
            onChange: function () {
                // просто обновляем отображение
                updateStatusUI();
            }
        });

        // Стать хостом
        Lampa.SettingsApi.addParam({
            component: PLUGIN_NAME,
            param: {
                name: 'remote_config_host_btn',
                type: 'trigger',
                default: false
            },
            field: {
                name: Lampa.Lang.translate('remote_config_host'),
                description: 'Показать 6-значный код для подключения с ПК'
            },
            onChange: function () {
                startHost();
                // Показать код крупно
                setTimeout(function () {
                    if (hostCode) {
                        Lampa.Modal.open({
                            title: 'Код для подключения',
                            html: '<div style="padding:2em;text-align:center;">' +
                                '<div style="font-size:3.5em;font-weight:700;letter-spacing:0.15em;margin:0.5em 0;">' + hostCode + '</div>' +
                                '<div style="opacity:0.7;margin-top:1em;">Введите этот код на ПК в разделе Remote Config</div>' +
                                '<div style="opacity:0.5;margin-top:1.5em;font-size:0.9em;">Код действует, пока открыто это окно или плагин активен</div>' +
                                '</div>',
                            onBack: function () {
                                Lampa.Modal.close();
                            }
                        });
                    }
                }, 600);
            }
        });

        // Подключиться
        Lampa.SettingsApi.addParam({
            component: PLUGIN_NAME,
            param: {
                name: 'remote_config_connect_btn',
                type: 'input',
                values: '',
                default: '',
                placeholder: 'Введите 6-значный код'
            },
            field: {
                name: Lampa.Lang.translate('remote_config_connect'),
                description: 'Введите код, который показывает ТВ'
            },
            onChange: function (value) {
                if (value && value.length >= 4) {
                    startClient(value);
                }
            }
        });

        // Отключиться
        Lampa.SettingsApi.addParam({
            component: PLUGIN_NAME,
            param: {
                name: 'remote_config_disconnect_btn',
                type: 'trigger',
                default: false
            },
            field: {
                name: Lampa.Lang.translate('remote_config_disconnect')
            },
            onChange: function () {
                destroyPeer();
                noty('Отключено', 'info');
            }
        });

        // О плагине
        Lampa.SettingsApi.addParam({
            component: PLUGIN_NAME,
            param: {
                name: 'remote_config_about_btn',
                type: 'trigger',
                default: false
            },
            field: {
                name: Lampa.Lang.translate('remote_config_about'),
                description: 'Удалённое управление плагинами Lampa по коду (PeerJS)'
            },
            onChange: function () {
                Lampa.Modal.open({
                    title: 'Lampa Remote Config',
                    html: '<div style="padding:1.2em;line-height:1.5;">' +
                        '<p>Плагин позволяет с ПК удалённо управлять списком плагинов на ТВ.</p>' +
                        '<p style="margin-top:1em;"><b>Как пользоваться:</b></p>' +
                        '<ol style="margin:0.5em 0 0 1.2em;">' +
                        '<li>На <b>ТВ</b> нажмите «Стать хостом» и запомните код</li>' +
                        '<li>На <b>ПК</b> введите этот код в поле «Подключиться»</li>' +
                        '<li>После соединения откроется экран управления плагинами ТВ</li>' +
                        '</ol>' +
                        '<p style="margin-top:1.2em;opacity:0.7;">Связь идёт напрямую (P2P) через PeerJS. Работает из любой сети.</p>' +
                        '</div>',
                    onBack: function () { Lampa.Modal.close(); }
                });
            }
        });
    }

    // ─── Init ──────────────────────────────────────────────────────────────

    function init() {
        initSettings();
        log('Plugin ready');
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
