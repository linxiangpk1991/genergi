import type { PropsWithChildren } from "react"
import { Link, useLocation } from "react-router-dom"
import { api } from "../api"

const navItems = [
  { to: "/", label: "任务启动" },
  { to: "/storyboard-review", label: "脚本管理" },
  { to: "/keyframe-review", label: "脚本审阅" },
  { to: "/batch-dashboard", label: "批量任务" },
  { to: "/asset-center", label: "素材资产" },
  { to: "/user-center", label: "用户中心" },
]

type AppLayoutProps = PropsWithChildren<{
  operator: string
}>

export function AppLayout({ children, operator }: AppLayoutProps) {
  const location = useLocation()

  async function handleLogout() {
    await api.logout()
    window.location.reload()
  }

  return (
    <div className="page-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-panel">
            <div className="brand-mark">G</div>
            <div>
              <div className="brand-name">GENERGI</div>
              <div className="brand-subtitle">自动化视频平台</div>
            </div>
          </div>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <Link
              key={item.to}
              className={location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to))
                ? "nav-item nav-item--active"
                : "nav-item"}
              to={item.to}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button className="primary-button primary-button--sidebar">+ New Task</button>
      </aside>
      <main className="workspace">
        <div className="workspace-toolbar">
          <input className="workspace-search" placeholder="Search..." />
          <div className="workspace-toolbar-actions">
            <button className="toolbar-icon" aria-label="通知">🔔</button>
            <button className="toolbar-icon" aria-label="帮助">?</button>
            <span className="operator-badge">管理员：{operator}</span>
            <button className="ghost-button" onClick={() => void handleLogout()}>
              退出登录
            </button>
          </div>
        </div>
        {children}
      </main>
    </div>
  )
}
