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
      const projectRoot = config.modRequest.projectRoot;
      const iconPath = path.resolve(projectRoot, config.expo.icon.replace('./', ''));
      
      console.log('🔍 [withAppIcon] Starting icon sync...');
      console.log(`   Project path: ${projectPath}`);
      console.log(`   Icon source: ${iconPath}`);
      console.log(`   Icon exists: ${fs.existsSync(iconPath)}`);
      
      if (!fs.existsSync(iconPath)) {
        console.error(`❌ [withAppIcon] Icon file not found at: ${iconPath}`);
        return config;
      }

      // Try multiple possible paths for AppIcon.appiconset
      const possiblePaths = [
        // Standard Expo path
        path.join(projectPath, config.expo.name || 'earshot-mobile', 'Images.xcassets', 'AppIcon.appiconset'),
        // Alternative with slug
        path.join(projectPath, config.expo.slug || 'earshot-mobile', 'Images.xcassets', 'AppIcon.appiconset'),
        // Root level
        path.join(projectPath, 'Images.xcassets', 'AppIcon.appiconset'),
        // Search recursively
        findAppIconSetRecursive(projectPath),
      ].filter(Boolean);

      let targetAppIconSet = null;
      for (const testPath of possiblePaths) {
        if (testPath && fs.existsSync(testPath)) {
          targetAppIconSet = testPath;
          console.log(`✅ [withAppIcon] Found AppIcon.appiconset at: ${testPath}`);
          break;
        }
      }

      if (!targetAppIconSet) {
        console.error(`❌ [withAppIcon] Could not find AppIcon.appiconset in any of these locations:`);
        possiblePaths.forEach(p => console.error(`   - ${p}`));
        return config;
      }

      // Copy icon to AppIcon.appiconset as icon-1024.png
      const targetIconPath = path.join(targetAppIconSet, 'icon-1024.png');
      try {
        fs.copyFileSync(iconPath, targetIconPath);
        console.log(`✅ [withAppIcon] Successfully copied icon to: ${targetIconPath}`);
        
        // Also update Contents.json to reference the icon
        const contentsJsonPath = path.join(targetAppIconSet, 'Contents.json');
        if (fs.existsSync(contentsJsonPath)) {
          const contents = JSON.parse(fs.readFileSync(contentsJsonPath, 'utf8'));
          // Find the 1024x1024 image entry and update it
          if (contents.images) {
            const image1024 = contents.images.find(img => img.size === '1024x1024');
            if (image1024) {
              image1024.filename = 'icon-1024.png';
              fs.writeFileSync(contentsJsonPath, JSON.stringify(contents, null, 2));
              console.log(`✅ [withAppIcon] Updated Contents.json`);
            }
          }
        }
      } catch (error) {
        console.error(`❌ [withAppIcon] Error copying icon: ${error.message}`);
      }

      return config;
    },
  ]);
};

/**
 * Recursively search for AppIcon.appiconset directory
 */
function findAppIconSetRecursive(dir, maxDepth = 3, currentDepth = 0) {
  if (currentDepth >= maxDepth) return null;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'AppIcon.appiconset') {
          return fullPath;
        }
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const found = findAppIconSetRecursive(fullPath, maxDepth, currentDepth + 1);
          if (found) return found;
        }
      }
    }
  } catch (error) {
    // Ignore permission errors
  }
  return null;
}

module.exports = withAppIcon;

