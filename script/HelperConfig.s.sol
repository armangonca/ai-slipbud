// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";

/// @title HelperConfig
/// @notice Deploy edilecek ağa göre otomatik adres seçimi yapar.
///         block.chainid üzerinden hangi ağda olduğunu algılar.
contract HelperConfig is Script {
    // ---- Structs ---- //
    struct NetworkConfig {
        address weth;
        address uniswapV2Router;
        address uniswapV3Router;
        address sushiswapRouter;
        address aaveV3Pool;
    }

    // ---- State ---- //
    NetworkConfig public activeConfig;

    // ---- Chain IDs ---- //
    uint256 constant ETH_MAINNET = 1;
    uint256 constant ETH_SEPOLIA = 11155111;
    uint256 constant POLYGON = 137;
    uint256 constant ARBITRUM = 42161;
    uint256 constant BASE = 8453;
    uint256 constant ANVIL = 31337;

    // ---- Errors ---- //
    error HelperConfig__UnsupportedChain(uint256 chainId);

    constructor() {
        if (block.chainid == ETH_MAINNET) {
            activeConfig = getEthMainnetConfig();
        } else if (block.chainid == ETH_SEPOLIA) {
            activeConfig = getSepoliaConfig();
        } else if (block.chainid == POLYGON) {
            activeConfig = getPolygonConfig();
        } else if (block.chainid == ARBITRUM) {
            activeConfig = getArbitrumConfig();
        } else if (block.chainid == BASE) {
            activeConfig = getBaseConfig();
        } else if (block.chainid == ANVIL) {
            activeConfig = getAnvilConfig();
        } else {
            revert HelperConfig__UnsupportedChain(block.chainid);
        }
    }

    // ---- Network Configs ---- //

    function getEthMainnetConfig() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            weth: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
            uniswapV2Router: 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D,
            uniswapV3Router: 0xE592427A0AEce92De3Edee1F18E0157C05861564,
            sushiswapRouter: 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F,
            aaveV3Pool: 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
        });
    }

    function getSepoliaConfig() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            weth: 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14,
            uniswapV2Router: 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3,
            uniswapV3Router: 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E,
            sushiswapRouter: address(0), // Sepolia'da SushiSwap yok
            aaveV3Pool: 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
        });
    }

    function getPolygonConfig() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            weth: 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270, // WMATIC
            uniswapV2Router: 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff, // QuickSwap (V2 fork)
            uniswapV3Router: 0xE592427A0AEce92De3Edee1F18E0157C05861564,
            sushiswapRouter: 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506,
            aaveV3Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
        });
    }

    function getArbitrumConfig() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            weth: 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1,
            uniswapV2Router: 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24, // Uniswap V2 on Arbitrum
            uniswapV3Router: 0xE592427A0AEce92De3Edee1F18E0157C05861564,
            sushiswapRouter: 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506,
            aaveV3Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
        });
    }

    function getBaseConfig() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            weth: 0x4200000000000000000000000000000000000006,
            uniswapV2Router: 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24,
            uniswapV3Router: 0x2626664c2603336E57B271c5C0b26F421741e481,
            sushiswapRouter: address(0), // Base'de SushiSwap yok
            aaveV3Pool: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
        });
    }

    function getAnvilConfig() internal returns (NetworkConfig memory) {
        // Anvil'de gerçek kontratlar yok — mock adresler deploy ediyoruz
        address mockWeth = deployMockContract("MockWETH");
        address mockUniV2 = deployMockContract("MockUniswapV2Router");
        address mockUniV3 = deployMockContract("MockUniswapV3Router");
        address mockSushi = deployMockContract("MockSushiSwapRouter");
        address mockAave = deployMockContract("MockAavePool");

        return NetworkConfig({
            weth: mockWeth,
            uniswapV2Router: mockUniV2,
            uniswapV3Router: mockUniV3,
            sushiswapRouter: mockSushi,
            aaveV3Pool: mockAave
        });
    }

    /// @notice Anvil için deterministik mock adres oluşturur
    function deployMockContract(string memory label) internal returns (address mock) {
        mock = makeAddr(label);
        vm.etch(mock, hex"01"); // Adrese minimal bytecode yaz ki kontrat olarak algılansın
    }

    /// @notice Aktif config'deki izinli router'ları array olarak döner (address(0) olanları atlar)
    function getAllowedRouters() external view returns (address[] memory) {
        uint256 count = 0;
        if (activeConfig.uniswapV2Router != address(0)) count++;
        if (activeConfig.uniswapV3Router != address(0)) count++;
        if (activeConfig.sushiswapRouter != address(0)) count++;

        address[] memory routers = new address[](count);
        uint256 idx = 0;

        if (activeConfig.uniswapV2Router != address(0)) {
            routers[idx++] = activeConfig.uniswapV2Router;
        }
        if (activeConfig.uniswapV3Router != address(0)) {
            routers[idx++] = activeConfig.uniswapV3Router;
        }
        if (activeConfig.sushiswapRouter != address(0)) {
            routers[idx++] = activeConfig.sushiswapRouter;
        }

        return routers;
    }

    /// @notice Ethereum mainnet tokenlarını döner — diğer ağlar için genişletilecek
    function getAllowedTokens() external view returns (address[] memory) {
        // Her ağda en azından WETH (veya wrapped native) izinli
        address[] memory tokens;

        if (block.chainid == ETH_MAINNET || block.chainid == ANVIL) {
            tokens = new address[](5);
            tokens[0] = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // WETH
            tokens[1] = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48; // USDC
            tokens[2] = 0xdAC17F958D2ee523a2206206994597C13D831ec7; // USDT
            tokens[3] = 0x6B175474E89094C44Da98b954EedeAC495271d0F; // DAI
            tokens[4] = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599; // WBTC
        } else {
            // Diğer ağlarda sadece wrapped native
            tokens = new address[](1);
            tokens[0] = activeConfig.weth;
        }

        return tokens;
    }
}
