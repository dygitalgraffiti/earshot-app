cat > share-extension/ShareViewController.swift << 'EOF'
import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {
    let appGroupID = "group.com.anonymous.earshotmobile"
    
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
        
        // Handle URL sharing
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
                // Extract URL from text if present
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
        
        // Open main app via deep link
        if let url = URL(string: "earshotmobile://share?url=\(url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
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
EOF