module.exports = {
    appId: "com.tradingterminal.desktop",
    productName: "Trading Terminal",
    copyright: "Copyright (c) 2026 Trading Terminal",
    directories: {
        output: "release",
        buildResources: "build-resources",
    },
    files: [
        "dist/**/*",
        "node_modules/better-sqlite3/**/*",
        "node_modules/keytar/**/*",
        "!node_modules/**/*.{md,ts,map}",
    ],
    extraMetadata: {
        main: "dist/main/index.cjs",
    },
    win: {
        target: [{ target: "nsis", arch: ["x64"] }],
        icon: "build-resources/icon.ico",
    },
    nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: "Trading Terminal",
        installerIcon: "build-resources/icon.ico",
        uninstallerIcon: "build-resources/icon.ico",
        installerHeaderIcon: "build-resources/icon.ico",
    },
    asar: true,
    asarUnpack: [
        "node_modules/better-sqlite3/**/*",
        "node_modules/keytar/**/*",
    ],
    // Native addons are prepared in scripts/build-installer.mjs via
    // `electron-builder install-app-deps --platform win32 --arch x64`.
    npmRebuild: false,
    nodeGypRebuild: false,
    publish: {
        provider: 'github',
        owner: '123nnymus123-a11y',
        repo: 'TradingTerminal-SourceCode',
    },
};
