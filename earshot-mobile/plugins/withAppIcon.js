const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin to ensure app icon is synced to native iOS project
 * This is needed when ios/ folder exists (for share extension)
 */
const withAppIcon = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectPath = config.modRequest.platformProjectRoot;
      const iconPath = path.join(config.modRequest.projectRoot, config.expo.icon);
      
      // Find the AppIcon.appiconset directory
      const appIconSetPath = path.join(
        projectPath,
        config.expo.name || 'earshot-mobile',
        'Images.xcassets',
        'AppIcon.appiconset'
      );

      // Alternative path if bundle name is different
      const altAppIconSetPath = path.join(
        projectPath,
        'Images.xcassets',
        'AppIcon.appiconset'
      );

      let targetAppIconSet = appIconSetPath;
      if (!fs.existsSync(appIconSetPath) && fs.existsSync(altAppIconSetPath)) {
        targetAppIconSet = altAppIconSetPath;
      }

      if (fs.existsSync(targetAppIconSet) && fs.existsSync(iconPath)) {
        // Copy icon to AppIcon.appiconset as icon-1024.png
        const targetIconPath = path.join(targetAppIconSet, 'icon-1024.png');
        fs.copyFileSync(iconPath, targetIconPath);
        console.log(`✅ Copied app icon to ${targetIconPath}`);
      } else {
        console.warn(`⚠️  Could not find AppIcon.appiconset or icon file`);
        console.warn(`   Looking for: ${targetAppIconSet}`);
        console.warn(`   Icon path: ${iconPath}`);
      }

      return config;
    },
  ]);
};

module.exports = withAppIcon;