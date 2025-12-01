const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin to ensure app icon is synced to native iOS project
 * This is needed when ios/ folder exists (for share extension)
 * Works with EAS Build by creating directory structure if needed
 */
const withAppIcon = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectPath = config.modRequest.platformProjectRoot;
      const projectRoot = config.modRequest.projectRoot;
      
      // Get icon path - try iOS-specific first, then fallback to general
      const iconPath = path.resolve(
        projectRoot, 
        (config.expo.ios?.icon || config.expo.icon || './assets/images/icon.png').replace('./', '')
      );
      
      console.log('🔍 [withAppIcon] Starting icon sync...');
      console.log(`   Project path: ${projectPath}`);
      console.log(`   Icon source: ${iconPath}`);
      console.log(`   Icon exists: ${fs.existsSync(iconPath)}`);
      
      if (!fs.existsSync(iconPath)) {
        console.error(`❌ [withAppIcon] Icon file not found at: ${iconPath}`);
        console.error(`   Please ensure the icon file exists and is committed to git.`);
        return config;
      }

      // Try multiple possible paths for AppIcon.appiconset
      const appName = config.expo.name || config.expo.slug || 'earshot-mobile';
      const possibleBasePaths = [
        // Standard Expo path (most common)
        path.join(projectPath, appName, 'Images.xcassets'),
        // Alternative structure
        path.join(projectPath, 'Images.xcassets'),
        // Search recursively for Images.xcassets
        findImagesXcassetsRecursive(projectPath),
      ].filter(Boolean);

      let targetAppIconSet = null;
      let imagesXcassetsPath = null;

      // First, try to find existing AppIcon.appiconset
      for (const basePath of possibleBasePaths) {
        if (basePath && fs.existsSync(basePath)) {
          const appIconPath = path.join(basePath, 'AppIcon.appiconset');
          if (fs.existsSync(appIconPath)) {
            targetAppIconSet = appIconPath;
            imagesXcassetsPath = basePath;
            console.log(`✅ [withAppIcon] Found existing AppIcon.appiconset at: ${targetAppIconSet}`);
            break;
          }
        }
      }

      // If not found, create it in the first valid base path
      if (!targetAppIconSet) {
        for (const basePath of possibleBasePaths) {
          if (basePath) {
            // Create Images.xcassets if it doesn't exist
            if (!fs.existsSync(basePath)) {
              fs.mkdirSync(basePath, { recursive: true });
              console.log(`📁 [withAppIcon] Created Images.xcassets at: ${basePath}`);
            }
            
            // Create AppIcon.appiconset
            const appIconPath = path.join(basePath, 'AppIcon.appiconset');
            if (!fs.existsSync(appIconPath)) {
              fs.mkdirSync(appIconPath, { recursive: true });
              console.log(`📁 [withAppIcon] Created AppIcon.appiconset at: ${appIconPath}`);
            }
            
            targetAppIconSet = appIconPath;
            imagesXcassetsPath = basePath;
            console.log(`✅ [withAppIcon] Using AppIcon.appiconset at: ${targetAppIconSet}`);
            break;
          }
        }
      }

      if (!targetAppIconSet) {
        console.error(`❌ [withAppIcon] Could not find or create AppIcon.appiconset`);
        console.error(`   Tried paths: ${possibleBasePaths.join(', ')}`);
        return config;
      }

      // Copy icon to AppIcon.appiconset as icon-1024.png
      const targetIconPath = path.join(targetAppIconSet, 'icon-1024.png');
      try {
        fs.copyFileSync(iconPath, targetIconPath);
        console.log(`✅ [withAppIcon] Successfully copied icon to: ${targetIconPath}`);
        
        // Create or update Contents.json to reference the icon
        const contentsJsonPath = path.join(targetAppIconSet, 'Contents.json');
        let contents = {
          images: [],
          info: {
            author: 'xcode',
            version: 1
          }
        };

        // Load existing Contents.json if it exists
        if (fs.existsSync(contentsJsonPath)) {
          try {
            contents = JSON.parse(fs.readFileSync(contentsJsonPath, 'utf8'));
          } catch (e) {
            console.warn(`⚠️ [withAppIcon] Could not parse existing Contents.json, creating new one`);
          }
        }

        // Ensure images array exists
        if (!contents.images || !Array.isArray(contents.images)) {
          contents.images = [];
        }

        // Find or create the 1024x1024 image entry
        let image1024 = contents.images.find(img => img.size === '1024x1024' && img.filename);
        if (!image1024) {
          // Create new entry if it doesn't exist
          image1024 = {
            filename: 'icon-1024.png',
            idiom: 'universal',
            platform: 'ios',
            size: '1024x1024'
          };
          contents.images.push(image1024);
        } else {
          // Update existing entry
          image1024.filename = 'icon-1024.png';
        }

        // Write Contents.json
        fs.writeFileSync(contentsJsonPath, JSON.stringify(contents, null, 2));
        console.log(`✅ [withAppIcon] Updated Contents.json`);
        
      } catch (error) {
        console.error(`❌ [withAppIcon] Error copying icon: ${error.message}`);
        console.error(error.stack);
      }

      return config;
    },
  ]);
};

/**
 * Recursively search for Images.xcassets directory
 */
function findImagesXcassetsRecursive(dir, maxDepth = 4, currentDepth = 0) {
  if (currentDepth >= maxDepth) return null;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'Images.xcassets') {
          return fullPath;
        }
        // Skip common directories that won't contain Images.xcassets
        if (!entry.name.startsWith('.') && 
            entry.name !== 'node_modules' && 
            entry.name !== 'Pods' &&
            entry.name !== 'build' &&
            entry.name !== 'DerivedData') {
          const found = findImagesXcassetsRecursive(fullPath, maxDepth, currentDepth + 1);
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

