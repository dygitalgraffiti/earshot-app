const { withEntitlements, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SHARE_EXTENSION_NAME = 'ShareExtension';
const APP_GROUP_ID = 'group.com.anonymous.earshotmobile';
const SHARE_EXTENSION_BUNDLE_ID = 'com.anonymous.earshotmobile.ShareExtension';

const withShareExtension = (config) => {
  config = withEntitlements(config, (config) => {
    if (!config.modResults['com.apple.security.application-groups']) {
      config.modResults['com.apple.security.application-groups'] = [APP_GROUP_ID];
    } else {
      const appGroups = config.modResults['com.apple.security.application-groups'];
      if (!appGroups.includes(APP_GROUP_ID)) {
        appGroups.push(APP_GROUP_ID);
      }
    }
    return config;
  });

  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const projectPath = config.modRequest.projectRoot;
    const iosPath = path.join(projectPath, 'ios');
    const sourceExtensionPath = path.join(projectPath, 'share-extension');
    const targetExtensionPath = path.join(iosPath, SHARE_EXTENSION_NAME);

    if (!fs.existsSync(targetExtensionPath)) {
      fs.mkdirSync(targetExtensionPath, { recursive: true });
    }

    const sourceSwiftFile = path.join(sourceExtensionPath, 'ShareViewController.swift');
    const targetSwiftFile = path.join(targetExtensionPath, 'ShareViewController.swift');
    if (fs.existsSync(sourceSwiftFile)) {
      fs.copyFileSync(sourceSwiftFile, targetSwiftFile);
    } else {
      const defaultSwiftCode = `import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {
    let appGroupID = "${APP_GROUP_ID}"
    
    override func viewDidLoad() {
        super.viewDidLoad()
        self.placeholder = "Share to Earshot"
    }
    
    override func isContentValid() -> Bool {
        return true
    }
    
    override func didSelectPost() {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
              let itemProvider = extensionItem.attachments?.first else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        
        if itemProvider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            itemProvider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] (item, error) in
                guard let self = self, let url = item as? URL else {
                    self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                    return
                }
                self.saveSharedURL(url.absoluteString)
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        } else if itemProvider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            itemProvider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] (item, error) in
                guard let self = self, let text = item as? String else {
                    self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                    return
                }
                if let url = self.extractURL(from: text) {
                    self.saveSharedURL(url)
                } else {
                    self.saveSharedURL(text)
                }
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        } else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
    
    override func configurationItems() -> [Any]! {
        return []
    }
    
    private func saveSharedURL(_ url: String) {
        guard let sharedDefaults = UserDefaults(suiteName: appGroupID) else { return }
        sharedDefaults.set(url, forKey: "pendingShareUrl")
        sharedDefaults.synchronize()
        
        if let url = URL(string: "earshotmobile://share?url=\\(url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
            var responder = self as UIResponder?
            while responder != nil {
                if let application = responder as? UIApplication {
                    application.open(url, options: [:], completionHandler: nil)
                    break
                }
                responder = responder?.next
            }
        }
    }
    
    private func extractURL(from text: String) -> String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let matches = detector?.matches(in: text, options: [], range: NSRange(location: 0, length: text.utf16.count))
        return matches?.first?.url?.absoluteString
    }
}
`;
      fs.writeFileSync(targetSwiftFile, defaultSwiftCode);
    }

    const sourceInfoPlist = path.join(sourceExtensionPath, 'Info.plist');
    const targetInfoPlist = path.join(targetExtensionPath, 'Info.plist');
    if (fs.existsSync(sourceInfoPlist)) {
      fs.copyFileSync(sourceInfoPlist, targetInfoPlist);
    } else {
      const defaultInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>Earshot Share</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionAttributes</key>
		<dict>
			<key>NSExtensionActivationRule</key>
			<dict>
				<key>NSExtensionActivationSupportsText</key>
				<true/>
				<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
				<integer>1</integer>
				<key>NSExtensionActivationSupportsWebPageWithMaxCount</key>
				<integer>1</integer>
			</dict>
		</dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.share-services</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
	</dict>
</dict>
</plist>
`;
      fs.writeFileSync(targetInfoPlist, defaultInfoPlist);
    }

    const mainTarget = xcodeProject.getTarget('earshotmobile') || xcodeProject.getFirstTarget();
    if (!mainTarget) {
      console.warn('Could not find main app target');
      return config;
    }

    const mainTargetUuid = mainTarget.uuid;

    const existingTarget = xcodeProject.getTarget(SHARE_EXTENSION_NAME);
    if (existingTarget) {
      console.log('Share extension target already exists');
      return config;
    }

    const shareExtensionTarget = xcodeProject.addTarget(
      SHARE_EXTENSION_NAME,
      'app_extension',
      SHARE_EXTENSION_NAME,
      `ios/${SHARE_EXTENSION_NAME}`
    );

    xcodeProject.addBuildProperty('PRODUCT_BUNDLE_IDENTIFIER', SHARE_EXTENSION_BUNDLE_ID, undefined, shareExtensionTarget.uuid);
    xcodeProject.addBuildProperty('SWIFT_VERSION', '5.0', undefined, shareExtensionTarget.uuid);
    xcodeProject.addBuildProperty('DEVELOPMENT_TEAM', '', undefined, shareExtensionTarget.uuid);
    xcodeProject.addBuildProperty('CODE_SIGN_STYLE', 'Automatic', undefined, shareExtensionTarget.uuid);

    xcodeProject.addFile(
      path.join('ios', SHARE_EXTENSION_NAME, 'ShareViewController.swift'),
      shareExtensionTarget.targetType,
      { target: shareExtensionTarget.uuid }
    );

    xcodeProject.addFile(
      path.join('ios', SHARE_EXTENSION_NAME, 'Info.plist'),
      shareExtensionTarget.targetType,
      { target: shareExtensionTarget.uuid }
    );

    const shareExtensionEntitlementsPath = path.join(iosPath, SHARE_EXTENSION_NAME, `${SHARE_EXTENSION_NAME}.entitlements`);
    if (!fs.existsSync(shareExtensionEntitlementsPath)) {
      const entitlements = {
        'com.apple.security.application-groups': [APP_GROUP_ID]
      };
      fs.writeFileSync(shareExtensionEntitlementsPath, JSON.stringify(entitlements, null, 2));
    }

    xcodeProject.addBuildProperty('CODE_SIGN_ENTITLEMENTS', `${SHARE_EXTENSION_NAME}/${SHARE_EXTENSION_NAME}.entitlements`, undefined, shareExtensionTarget.uuid);
    xcodeProject.addTargetDependency(mainTargetUuid, shareExtensionTarget.uuid);

    const embedPhase = xcodeProject.pbxEmbedFrameworksBuildPhaseObj(mainTargetUuid);
    if (embedPhase) {
      const embedFile = xcodeProject.addFile(
        `\$(BUILT_PRODUCTS_DIR)/${SHARE_EXTENSION_NAME}.appex`,
        embedPhase.uuid,
        { target: mainTargetUuid }
      );
      if (embedFile) {
        xcodeProject.addToPbxEmbedFrameworksBuildPhase(embedFile);
      }
    }

    return config;
  });

  return config;
};

module.exports = withShareExtension;
