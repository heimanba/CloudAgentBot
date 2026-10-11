// React 19 的 development build 通过 IS_REACT_ACT_ENVIRONMENT 判断当前是否处于支持 act 的环境：
// 未设置时每次 act() 调用都会打印 "not configured to support act(...)" 警告，且不会检测未包裹
// act 的状态更新；设置后 act 静默工作并启用该检测。此处全局声明，测试文件不再逐个内联设置。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
