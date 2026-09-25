import React from 'react'
import ReactDOM from 'react-dom/client'
import { Ion } from 'cesium'
import App from './App'
import './styles/global.css'

// We use ArcGIS public tile servers (no token required).
// Clear the Ion token to suppress 401 errors from Cesium's default Ion requests.
Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjJvazdHQXU2RU85MWJfYnkiLCJqdGkiOiI5ZTYxZjhmOC1jODg2LTRlNjQtOWQ4ZS1hNjgyZDY3NmYzOGIiLCJpZCI6NTA3NjAzLCJzdWIiOiJKYWNvYk1heG9uIiwiaXNzIjoiaHR0cHM6Ly9hcGkuY2VzaXVtLmNvbSIsImF1ZCI6IlBvbGFyaXMiLCJpYXQiOjE3OTAzNDYyNjZ9.zXYAQVKbVVZPuUQ0sYv6yWPQgllqjjsj8IWFdDe5kwU'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
