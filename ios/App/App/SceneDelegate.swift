import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private func reportActivity(_ active: Bool) {
        guard let controller = window?.rootViewController as? CAPBridgeViewController else { return }
        controller.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('equanimity:app-state', { detail: { active: \(active ? "true" : "false") } }));", completionHandler: nil)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        EquanimityBackupSafety.protectDeviceStorage()
        reportActivity(true)
    }
    func sceneDidEnterBackground(_ scene: UIScene) { reportActivity(false) }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = EquanimityBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
