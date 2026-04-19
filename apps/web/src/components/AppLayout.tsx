import type { PropsWithChildren } from "react"
import { Link, useLocation } from "react-router-dom"
import { api } from "../api"

const navGroups = [
  {
    label: "生产工作区",
    items: [
      { to: "/", label: "任务启动" },
      { to: "/storyboard-review", label: "分镜审阅" },
      { to: "/keyframe-review", label: "关键帧审阅" },
      { to: "/task-review", label: "任务审核" },
      { to: "/batch-dashboard", label: "生产看板" },
      { to: "/asset-center", label: "交付资产" },
    ],
  },
  {
    label: "系统管理",
    items: [
      { to: "/project-library", label: "项目审核库" },
      { to: "/help-center", label: "帮助中心" },
      { to: "/model-control-center", label: "模型控制中心" },
      { to: "/user-center", label: "用户中心" },
    ],
  },
] as const

type AppLayoutProps = PropsWithChildren<{
  operator: string
}>

function getWorkspaceMeta(pathname: string) {
  if (pathname === "/storyboard-review") {
    return {
      title: "分镜审阅",
      description: "确认每个分镜的表达、节奏和脚本是否对齐内容母本。",
    }
  }

  if (pathname === "/keyframe-review") {
    return {
      title: "关键帧审阅",
      description: "查看真实关键帧，判断画面主体、质感和风格是否达标。",
    }
  }

  if (pathname === "/task-review") {
    return {
      title: "任务审核",
      description: "整任务查看蓝图、关键画面、提示词和尺寸规格，通过后再继续完整视频生成。",
    }
  }

  if (pathname === "/batch-dashboard") {
    return {
      title: "生产看板",
      description: "只看真实任务、真实运行状态和需要人工处理的异常。",
    }
  }

  if (pathname === "/asset-center") {
    return {
      title: "交付资产",
      description: "查看最终视频、字幕、脚本和中间资产。",
    }
  }

  if (pathname.startsWith("/model-control-center")) {
    return {
      title: "模型控制中心",
      description: "管理 Provider、模型和默认值。",
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
      title: "项目审核库",
      description: "查看当前项目沉淀下来的审核通过蓝图与复用素材。",
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
    description: "从内容母本开始，把一次完整的短视频生产任务发起出去。",
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
