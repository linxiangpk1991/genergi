import { useEffect, useState } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { api } from "./api"
import { AppLayout } from "./components/AppLayout"
import { BatchDashboardPage } from "./pages/BatchDashboardPage"
import { HomePage } from "./pages/HomePage"
import { KeyframeReviewPage } from "./pages/KeyframeReviewPage"
import { LoginPage } from "./pages/LoginPage"
import { AssetsPage } from "./pages/AssetsPage"
import { UserCenterPage } from "./pages/UserCenterPage"
import { StoryboardReviewPage } from "./pages/StoryboardReviewPage"
import { ModelControlCenterPage } from "./pages/ModelControlCenterPage"
import { ModelProvidersPage } from "./pages/ModelProvidersPage"
import { ModelRegistryPage } from "./pages/ModelRegistryPage"
import { ModelDefaultsPage } from "./pages/ModelDefaultsPage"
import { HelpCenterHomePage } from "./pages/HelpCenterHomePage"
import { HelpWorkflowPage } from "./pages/HelpWorkflowPage"
import { HelpFeaturePage } from "./pages/HelpFeaturePage"
import { HelpReleaseTimelinePage } from "./pages/HelpReleaseTimelinePage"

export function App() {
  const [authLoading, setAuthLoading] = useState(true)
  const [operator, setOperator] = useState<string | null>(null)

  useEffect(() => {
    async function loadSession() {
      try {
        const session = await api.session()
        setOperator(session.operator)
      } catch {
        setOperator(null)
      } finally {
        setAuthLoading(false)
      }
    }

    void loadSession()
  }, [])

  if (authLoading) {
    return <div className="empty-state">GENERGI 正在验证登录状态...</div>
  }

  if (!operator) {
    return <LoginPage onLoggedIn={setOperator} />
  }

  return (
    <AppLayout operator={operator}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/storyboard-review" element={<StoryboardReviewPage />} />
        <Route path="/keyframe-review" element={<KeyframeReviewPage />} />
        <Route path="/batch-dashboard" element={<BatchDashboardPage />} />
        <Route path="/asset-center" element={<AssetsPage />} />
        <Route path="/user-center" element={<UserCenterPage />} />
        <Route path="/help-center" element={<HelpCenterHomePage />} />
        <Route path="/help-center/workflows/:workflowId" element={<HelpWorkflowPage />} />
        <Route path="/help-center/features/:featureId" element={<HelpFeaturePage />} />
        <Route path="/help-center/releases" element={<HelpReleaseTimelinePage />} />
        <Route path="/model-control-center" element={<ModelControlCenterPage />} />
        <Route path="/model-control-center/providers" element={<ModelProvidersPage />} />
        <Route path="/model-control-center/registry" element={<ModelRegistryPage />} />
        <Route path="/model-control-center/defaults" element={<ModelDefaultsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  )
}
