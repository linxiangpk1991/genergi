import type { PropsWithChildren } from "react"
import { Link, useLocation } from "react-router-dom"
import { api } from "../api"

const navGroups = [
  {
    label: "生产工作区",
    items: [
      { to: "/", label: "任务启动" },
      { to: "/task-review", label: "任务审核" },
      { to: "/batch-dashboard", label: "生产看板" },
      { to: "/asset-center", label: "素材与交付" },
    ],
  },
  {
    label: "系统管理",
    items: [
      { to: "/project-library", label: "项目模板库" },
      { to: "/help-center", label: "帮助中心" },
      { to: "/model-control-center", label: "模型设置" },
      { to: "/user-center", label: "用户中心" },
    ],
  },
] as const

type AppLayoutProps = PropsWithChildren<{
  operator: string
}>

function getWorkspaceMeta(pathname: string) {
  if (pathname === "/task-review") {
    return {
      title: "任务审核",
      description: "先检查整条视频的生成方案、关键画面和画幅，确认没问题后再继续生成正片。",
    }
  }

  if (pathname === "/batch-dashboard") {
    return {
      title: "生产看板",
      description: "集中查看任务进度、卡住情况和需要人工处理的问题。",
    }
  }

  if (pathname === "/asset-center") {
    return {
      title: "素材与交付",
      description: "查看成片、字幕、脚本、分段视频和排查用文件。",
    }
  }

  if (pathname.startsWith("/model-control-center")) {
    return {
      title: "模型设置",
      description: "管理模型接入方、可用模型和新任务默认使用的模型。",
    }
  }

  if (pathname.startsWith("/help-center")) {
    return {
      title: "帮助中心",
      description: "按流程学习、按功能查阅，并查看版本更新时间线。",
    }
  }

  if (pathname === "/project-library") {
    return {
      title: "项目模板库",
      description: "查看项目里已经确认过的生成方案和可复用风格。",
    }
  }

  if (pathname === "/user-center") {
    return {
      title: "用户中心",
      description: "维护内部账号、状态和密码，不展示无效入口。",
    }
  }

  return {
    title: "任务启动",
    description: "从原始文案开始，新建一条完整的短视频生产任务。",
  }
}

export function AppLayout({ children, operator }: AppLayoutProps) {
  const location = useLocation()
  const isHome = location.pathname === "/"
  const workspaceMeta = getWorkspaceMeta(location.pathname)

  async function handleLogout() {
    await api.logout()
    window.location.reload()
  }

  return (
    <div className="page-shell">
      <aside className="sidebar">
        <div className="sidebar-main">
          <div className="brand-panel">
            <img src="/assets/logo.png" alt="GENERGI Logo" className="brand-logo" />
          </div>

          <div className="sidebar-nav-groups">
            {navGroups.map((group) => (
              <div key={group.label} className="nav-group">
                <div className="nav-group__label">{group.label}</div>
                <nav className="nav-list">
                  {group.items.map((item) => (
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
              </div>
            ))}
          </div>
        </div>
      </aside>
      <main className="workspace">
        <div className="workspace-toolbar">
          <div className="workspace-toolbar-copy">
            <span className="workspace-toolbar-kicker">{isHome ? "工作入口" : "当前工作区"}</span>
            <strong>{workspaceMeta.title}</strong>
            <span>{workspaceMeta.description}</span>
          </div>
          <div className="workspace-toolbar-actions">
            {!isHome ? <Link className="ghost-button" to="/">返回任务入口</Link> : null}
            <span className="pill pill--accent">English Output</span>
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
