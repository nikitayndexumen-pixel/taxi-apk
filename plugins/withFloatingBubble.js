const { withAndroidManifest, withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withFloatingBubble(config) {
  // 1. Add permissions + service to AndroidManifest
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const app = manifest.application[0];

    if (!manifest['uses-permission']) manifest['uses-permission'] = [];
    const existing = manifest['uses-permission'].map(p => p.$['android:name']);
    const permsToAdd = [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
    ];
    permsToAdd.forEach(perm => {
      if (!existing.includes(perm)) {
        manifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    });

    if (!app.service) app.service = [];
    const svcNames = app.service.map(s => s.$['android:name']);
    if (!svcNames.includes('.FloatingBubbleService')) {
      app.service.push({
        $: {
          'android:name': '.FloatingBubbleService',
          'android:foregroundServiceType': 'dataSync',
          'android:exported': 'false',
        },
      });
    }
    return cfg;
  });

  // 2. Copy Kotlin source files into the android project
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const pkgDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/ru/taxiimpulse/app'
      );
      fs.mkdirSync(pkgDir, { recursive: true });

      const srcDir = path.join(cfg.modRequest.projectRoot, 'android-src');
      ['FloatingBubbleService.kt', 'FloatingBubbleModule.kt', 'FloatingBubblePackage.kt'].forEach(file => {
        const src = path.join(srcDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(pkgDir, file));
          console.log(`[withFloatingBubble] copied ${file}`);
        } else {
          console.warn(`[withFloatingBubble] WARNING: ${src} not found`);
        }
      });
      return cfg;
    },
  ]);

  // 3. Register FloatingBubblePackage in MainApplication.kt
  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;

    // Add import if missing
    if (!src.includes('FloatingBubblePackage')) {
      // Insert import after the last import statement
      src = src.replace(
        /(import com\.facebook\.react\.ReactApplication)/,
        'import ru.taxiimpulse.app.FloatingBubblePackage\n$1'
      );

      // Add to packages list — handle both "this" and "this@MainApplication" variants
      src = src.replace(
        /val packages = PackageList\(this@MainApplication\)\.packages/,
        'val packages = PackageList(this@MainApplication).packages\n      packages.add(FloatingBubblePackage())'
      );
      src = src.replace(
        /val packages = PackageList\(this\)\.packages/,
        'val packages = PackageList(this).packages\n      packages.add(FloatingBubblePackage())'
      );
    }

    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
}

module.exports = withFloatingBubble;
