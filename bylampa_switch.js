(function () {
    'use strict';

    /**
     * Переключатель на Lampa (bylampa.online)
     * - Пункт "ByLampa" в главном меню
     * - Раздел в настройках с кнопкой перехода
     * - Опция автоматического перехода при запуске (по умолчанию выключена)
     */

    if (window.plugin_bylampa_switch_ready) return;
    window.plugin_bylampa_switch_ready = true;

    var TARGET = 'http://bylampa.online';
    var TARGET_HOST = 'bylampa.online';
    var TITLE = 'ByLampa';

    var ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';

    function isTargetHost() {
        try {
            return location.hostname === TARGET_HOST;
        } catch (e) {
            return false;
        }
    }

    function goTo() {
        if (isTargetHost()) {
            Lampa.Noty.show('Вы уже в ' + TITLE);
            return;
        }

        Lampa.Noty.show('Переход в ' + TITLE + '...');

        setTimeout(function () {
            window.location.href = TARGET;
        }, 400);
    }

    function addMenuButton() {
        var item = $(
            '<li class="menu__item selector" data-action="bylampa_switch">' +
                '<div class="menu__ico">' + ICON + '</div>' +
                '<div class="menu__text">' + TITLE + '</div>' +
            '</li>'
        );

        item.on('hover:enter', goTo);
        $('.menu .menu__list').eq(0).append(item);
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'bylampa_switch',
            name: TITLE,
            icon: ICON
        });

        Lampa.SettingsApi.addParam({
            component: 'bylampa_switch',
            param: { name: 'bylampa_go', type: 'button' },
            field: {
                name: 'Перейти в ' + TITLE,
                description: TARGET
            },
            onChange: goTo
        });

        Lampa.SettingsApi.addParam({
            component: 'bylampa_switch',
            param: { name: 'bylampa_auto', type: 'trigger', default: false },
            field: {
                name: 'Переходить при запуске',
                description: 'Автоматически открывать ' + TITLE + ' при старте приложения'
            }
        });
    }

    function start() {
        addSettings();
        addMenuButton();

        if (Lampa.Storage.get('bylampa_auto', false) && !isTargetHost()) {
            goTo();
        }
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();
