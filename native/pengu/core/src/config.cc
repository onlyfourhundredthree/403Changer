#include "pengu.h"
#include <fstream>
#include <cstdarg>
#include <unordered_map>
#include "include/cef_version.h"

#if OS_WIN
EXTERN_C IMAGE_DOS_HEADER __ImageBase;
#elif OS_MAC
#include <dlfcn.h>
#include <libgen.h>
#endif


#if OS_WIN
// ---------------------------------------------------------------------------
// 403Changer: shared config.ini
//
// 403Changer keeps one config.ini under %LOCALAPPDATA%\403Changer and writes it
// in the ANSI code page, so it is read through the Windows INI API. Older
// installs mirrored it to %LOCALAPPDATA%\Rose, which is still accepted.
//   [General] disabled   = 1 -> do not hook anything
//   [General] loaderpath = <folder of this loader>, else the DLL's own folder
// ---------------------------------------------------------------------------
static std::wstring changer_config_path()
{
    static std::wstring cached;
    static bool resolved = false;
    if (resolved)
        return cached;
    resolved = true;

    wchar_t base[2048]{};
    DWORD len = GetEnvironmentVariableW(L"LOCALAPPDATA", base, _countof(base));
    if (len == 0 || len >= _countof(base))
        return cached;

    static const wchar_t *const candidates[] = {
        L"\\403Changer\\config.ini",
        L"\\Rose\\config.ini",
    };
    for (const wchar_t *tail : candidates)
    {
        std::wstring candidate = std::wstring(base) + tail;
        if (GetFileAttributesW(candidate.c_str()) != INVALID_FILE_ATTRIBUTES)
        {
            cached = candidate;
            break;
        }
    }
    return cached;
}

static std::wstring changer_ini_value(const wchar_t *key)
{
    std::wstring ini = changer_config_path();
    if (ini.empty())
        return std::wstring();

    wchar_t buf[2048]{};
    GetPrivateProfileStringW(L"General", key, L"", buf, _countof(buf), ini.c_str());
    return buf;
}

static std::wstring changer_loader_override()
{
    static std::wstring cached;
    static bool resolved = false;
    if (!resolved)
    {
        resolved = true;
        std::wstring dir = changer_ini_value(L"loaderpath");
        while (!dir.empty() && (dir.back() == L'\\' || dir.back() == L'/'))
            dir.pop_back();
        if (!dir.empty())
        {
            DWORD attr = GetFileAttributesW(dir.c_str());
            if (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY))
                cached = dir;
        }
    }
    return cached;
}

bool config::changer_hook_disabled()
{
    return changer_ini_value(L"disabled") == L"1";
}

// ---------------------------------------------------------------------------
// 403Changer: core.log (%LOCALAPPDATA%\403Changer\core.log, rotated at 512 KB)
// ---------------------------------------------------------------------------
void config::changer_log(const char *fmt, ...)
{
    wchar_t base[2048]{};
    DWORD len = GetEnvironmentVariableW(L"LOCALAPPDATA", base, _countof(base));
    if (len == 0 || len >= _countof(base))
        return;

    std::wstring dir = std::wstring(base) + L"\\403Changer";
    DWORD attr = GetFileAttributesW(dir.c_str());
    if (attr == INVALID_FILE_ATTRIBUTES || !(attr & FILE_ATTRIBUTE_DIRECTORY))
        return; // never create the folder from inside the League process

    std::wstring file = dir + L"\\core.log";

    static bool rotated = false;
    if (!rotated)
    {
        rotated = true;
        WIN32_FILE_ATTRIBUTE_DATA info{};
        if (GetFileAttributesExW(file.c_str(), GetFileExInfoStandard, &info) && info.nFileSizeLow > 512 * 1024)
            MoveFileExW(file.c_str(), (file + L".old").c_str(), MOVEFILE_REPLACE_EXISTING);
    }

    char message[1024];
    va_list args;
    va_start(args, fmt);
    vsnprintf(message, sizeof(message) - 1, fmt, args);
    va_end(args);
    message[sizeof(message) - 1] = '\0';

    SYSTEMTIME t;
    GetLocalTime(&t);
    char line[1200];
    int n = snprintf(line, sizeof(line) - 1, "[%02d:%02d:%02d] [pid %lu] %s\r\n",
        t.wHour, t.wMinute, t.wSecond, GetCurrentProcessId(), message);
    if (n <= 0)
        return;

    HANDLE h = CreateFileW(file.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
        nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE)
        return;
    DWORD written = 0;
    WriteFile(h, line, (DWORD)n, &written, nullptr);
    CloseHandle(h);
}
#else
bool config::changer_hook_disabled() { return false; }
void config::changer_log(const char *, ...) {}
#endif

path config::loader_dir()
{
#if OS_WIN
    static std::wstring path;
    if (path.empty())
    {
        // 403Changer: the loader folder named in config.ini wins when it exists.
        std::wstring override_dir = changer_loader_override();
        if (!override_dir.empty())
            return path = override_dir;

        // Get this dll path.
        WCHAR thisPath[2048];
        GetModuleFileNameW((HINSTANCE)&__ImageBase, thisPath, ARRAYSIZE(thisPath) - 1);

        DWORD attr = GetFileAttributesW(thisPath);
        if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != FILE_ATTRIBUTE_REPARSE_POINT)
        {
            path = thisPath;
            return path = path.substr(0, path.find_last_of(L"/\\"));
        }

        OFSTRUCT of{};
        WCHAR finalPath[2048];
        // Get final path.
        HANDLE file = CreateFileW(thisPath, GENERIC_READ, 0x1, NULL, OPEN_EXISTING, 0, NULL);
        DWORD pathLength = GetFinalPathNameByHandleW(file, finalPath, 2048, FILE_NAME_OPENED);
        CloseHandle(file);

        std::wstring dir{ finalPath, pathLength };
        // Remove prepended '\\?\' by GetFinalPathNameByHandle()
        if (dir.rfind(L"\\\\?\\", 0) == 0)
            dir.erase(0, 4);

        // Get parent folder.
        return path = dir.substr(0, dir.find_last_of(L"/\\"));
    }
#elif OS_MAC
    static std::string path;
    if (path.empty())
    {
        Dl_info info;
        if (dladdr((const void *)&loader_dir, &info))
        {
            path = info.dli_fname;
            path = path.substr(0, path.rfind('/'));
        }
    }
#endif
    return path;
}

path config::datastore_path()
{
    return loader_dir() / "datastore";
}

path config::cache_dir()
{
#if OS_WIN
    wchar_t path[2048];
    size_t length = GetEnvironmentVariableW(L"LOCALAPPDATA", path, _countof(path));

    if (length == 0)
        return league_dir() / "Cache";

    lstrcatW(path, L"\\Riot Games\\League of Legends\\Cache");
    return path;
#else
    // inside the RiotClient folder 
    return "/Users/Shared/Riot Games/League Client/Cache";
#endif
}

path config::league_dir()
{
#if OS_WIN
    wchar_t buf[2048];
    size_t length = GetModuleFileNameW(nullptr, buf, _countof(buf));

    std::wstring path(buf, length);
    return path.substr(0, path.find_last_of(L"/\\"));
#else
    return "";
#endif
}

static void trim_tring(std::string &str)
{
    str.erase(str.find_last_not_of(' ') + 1);
    str.erase(0, str.find_first_not_of(' '));
}

static auto get_config_map()
{
    static bool cached = false;
    static std::unordered_map<std::string, std::string> map;

    if (!cached)
    {
        auto path = config::loader_dir() / "config";
        std::ifstream file(path);

        if (file.is_open())
        {
            std::string line;
            while (std::getline(file, line))
            {
                // ignore empty line or comment
                if (line.empty() || line[0] == ';' || line[0] == '#')
                    continue;

                size_t pos = line.find('=');
                if (pos != std::string::npos)
                {
                    std::string key = line.substr(0, pos);
                    std::string value = line.substr(pos + 1);

                    trim_tring(key);
                    trim_tring(value);

                    map[key] = value;
                }
            }
            file.close();
        }

        cached = true;
    }

    return map;
}

static std::string get_config_value(const char *key, const char *fallback)
{
    auto map = get_config_map();
    auto it = map.find(key);
    std::string value = fallback;

    if (it != map.end())
        value = it->second;

    return value;
}

static bool get_config_value_bool(const char *key, bool fallback)
{
    auto map = get_config_map();
    auto it = map.find(key);
    bool value = fallback;

    if (it != map.end())
    {
        if (it->second == "0" || it->second == "false")
            value = false;
        else if (it->second == "1" || it->second == "true")
            value = true;
    }

    return value;
}

static int get_config_value_int(const char *key, int fallback)
{
    auto map = get_config_map();
    auto it = map.find(key);
    int value = fallback;

    if (it != map.end())
        value = std::stoi(it->second);

    return value;
}

path config::plugins_dir()
{
    std::string cpath = get_config_value(__func__, "");
    if (!cpath.empty())
        return (const char8_t *)cpath.c_str();

    return loader_dir() / "plugins";
}

std::string config::disabled_plugins()
{
    return get_config_value(__func__, "");
}

namespace config::options
{
    bool use_hotkeys()
    {
#if 1 // CEF_VERSION_MAJOR == 91
        return true;
#endif
        return get_config_value_bool(__func__, true);
    }

    bool optimized_client()
    {
#if 1 // CEF_VERSION_MAJOR == 91
        return get_config_value_bool("OptimizeClient", true);
#endif
        return get_config_value_bool(__func__, true);
    }

    bool super_potato()
    {
#if 1 // CEF_VERSION_MAJOR == 91
        return get_config_value_bool("SuperLowSpecMode", false);
#endif
        return get_config_value_bool(__func__, false);
    }

    bool silent_mode()
    {
        return get_config_value_bool(__func__, false);
    }

    bool isecure_mode()
    {
#if 1 // CEF_VERSION_MAJOR == 91
        return get_config_value_bool("DisableWebSecurity", false);
#endif
        return get_config_value_bool(__func__, false);
    }

    bool use_devtools()
    {
#if 1 // CEF_VERSION_MAJOR == 91
        return true;
#endif
        return get_config_value_bool(__func__, false);
    }

    bool use_riotclient()
    {
#if 1 // CEF_VERSION_MAJOR == 91
        return true;
#endif
        return get_config_value_bool(__func__, false);
    }

    bool use_proxy()
    {
        return get_config_value_bool(__func__, false);
    }

    int debug_port()
    {
#if 1 // CEF_VERSION_MAJOR == 91
        return get_config_value_int("RemoteDebuggingPort", 0);
#endif
        return get_config_value_int(__func__, 0);
    }
}